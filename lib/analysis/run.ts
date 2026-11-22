import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { parseStoredConfigs } from './config';
import { filterPicks, scoreFixture } from './engine';
import { toPersistableResult } from './persistence';
import { enrichFixtures } from './ingestion/enrichment';
import { dateOnly, fetchFixtures, getEnabledLeagues } from './ingestion/fixtures';
import { assessAllLeagueReadiness, summarizeReadiness } from './ingestion/readiness';
import type { AnalysisSettings, Fixture, FixtureEnrichment } from '@/types/analysis';

export interface DailyRunResult {
  runId: string;
  status: 'completed' | 'failed' | 'running';
  fixturesAnalyzed: number;
  picksGenerated: number;
  alreadyRunning?: boolean;
  errors?: string[];
}

export interface AnalysisDependencies {
  fetchFixtures?: typeof fetchFixtures;
  enrichFixtures?: typeof enrichFixtures;
  scoreFixture?: typeof scoreFixture;
}

export async function loadAnalysisSettings(): Promise<AnalysisSettings> {
  const configs = await prisma.analysisConfig.findMany({
    where: { key: { in: ['confidence_threshold', 'market_weights', 'data_source_priorities'] } },
    select: { key: true, value: true },
  });
  return parseStoredConfigs(configs.map((config) => ({ key: config.key, value: config.value })));
}

export async function runDailyAnalysis(options: {
  now?: Date;
  force?: boolean;
  dependencies?: AnalysisDependencies;
} = {}): Promise<DailyRunResult> {
  const now = options.now ?? new Date();
  const day = dateOnly(now);
  const runDate = new Date(`${day}T00:00:00.000Z`);
  const dependencies = options.dependencies ?? {};
  const loadFixtures = dependencies.fetchFixtures ?? fetchFixtures;
  const enrich = dependencies.enrichFixtures ?? enrichFixtures;
  const score = dependencies.scoreFixture ?? scoreFixture;

  // Same-day idempotency: by default a scheduled run re-uses an existing
  // `running`/`completed` run for the day instead of creating a second one.
  // Re-runs are an intentional product feature, so we deliberately do NOT add a
  // unique constraint on `AnalysisRun.runDate` — instead callers must pass
  // `force: true` to start an additional run. Duplicate fixtures *within* a run
  // are prevented by the unique `AnalysisResult(runId, fixtureId)` index.
  if (!options.force) {
    const existing = await prisma.analysisRun.findFirst({
      where: { runDate, status: { in: ['running', 'completed'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        runId: existing.id,
        status: existing.status as 'completed' | 'running',
        fixturesAnalyzed: existing.fixturesAnalyzed,
        picksGenerated: existing.picksGenerated,
        alreadyRunning: existing.status === 'running',
      };
    }
  }

  const lockKey = `analysis:daily:${day}`;
  let hasLock = false;
  try {
    const result = await redis.set(lockKey, '1', { nx: true, ex: 600 });
    hasLock = result === 'OK';
  } catch (err) {
    // Do NOT pretend to hold a distributed lock. If Redis is unavailable we log
    // it and fall through; the database-level single-running-run-per-day guard
    // below still prevents concurrent runs.
    logger.warn('analysis.lock.unavailable', { day, error: err instanceof Error ? err.message : String(err) });
  }

  if (!hasLock) {
    const existing = await prisma.analysisRun.findFirst({
      where: { runDate, status: 'running' },
      orderBy: { createdAt: 'desc' },
    });
    if (existing) {
      return {
        runId: existing.id,
        status: 'running',
        fixturesAnalyzed: existing.fixturesAnalyzed,
        picksGenerated: existing.picksGenerated,
        alreadyRunning: true,
      };
    }
  }

  let run: { id: string };
  try {
    run = await prisma.analysisRun.create({
      data: { runDate, status: 'running', startedAt: now },
    });
  } catch (err) {
    // The partial unique index `AnalysisRun(runDate) WHERE status='running'`
    // rejects a second concurrent run for the same day (e.g. overlapping cron
    // invocations when the distributed lock was unavailable). Report the
    // in-flight run instead of failing.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      const existing = await prisma.analysisRun.findFirst({
        where: { runDate, status: 'running' },
        orderBy: { createdAt: 'desc' },
      });
      if (existing) {
        return {
          runId: existing.id,
          status: 'running',
          fixturesAnalyzed: existing.fixturesAnalyzed,
          picksGenerated: existing.picksGenerated,
          alreadyRunning: true,
        };
      }
    }
    throw err;
  }

  logger.info('analysis.run.started', { runId: run.id, day });

  try {
    const settings = await loadAnalysisSettings();
    const leagues = await getEnabledLeagues();

    // Stage 2: record league readiness. Entitlement that cannot be verified live
    // is labelled NOT_VERIFIED (never assumed); ineligible leagues report a clear
    // reason. A single failing league does not disable the others.
    const readiness = summarizeReadiness(assessAllLeagueReadiness(leagues, now));
    if (readiness.entitlementNotVerified.length > 0) {
      logger.warn('analysis.readiness.entitlementNotVerified', {
        count: readiness.entitlementNotVerified.length,
        leagues: readiness.entitlementNotVerified,
      });
    }
    const readinessErrors = readiness.ineligibleReasons.map(
      (entry) => `readiness: ${entry.leagueCode} not eligible — ${entry.reason}`,
    );

    const fixtureResult = await loadFixtures(leagues, settings, now);
    const enriched = await enrich(fixtureResult.fixtures, settings);
    const outcomes = enriched.map(({ fixture, enrichment }) => {
      const outcome = score(fixture, enrichment, settings);
      return {
        ...outcome,
        enrichmentQuality: enrichment.quality,
        providerSource: enrichment.dataSource,
        missingFields: enrichment.missingFields,
        oddsSource: oddsSourceOf(enrichment),
        oddsCapturedAt: enrichment.odds?.capturedAt ? new Date(enrichment.odds.capturedAt) : undefined,
      };
    });
    const picks = filterPicks(outcomes, settings.threshold);

    // Validate + map before touching the database so a malformed payload fails
    // the run before any rows are written.
    const rows = picks.map((pick) => toPersistableResult(run.id, pick));

    // Atomic finalisation: result persistence and run completion commit together
    // (or roll back together). A crash between the two can no longer leave a
    // `running` run that already has stored results. `skipDuplicates` makes the
    // write retry-safe against the unique `(runId, fixtureId)` index.
    const { inserted, completed } = await prisma.$transaction(async (tx) => {
      let inserted = 0;
      if (rows.length > 0) {
        const created = await tx.analysisResult.createMany({
          data: rows as unknown as Prisma.AnalysisResultCreateManyInput[],
          skipDuplicates: true,
        });
        inserted = created.count;
      }
      const updated = await tx.analysisRun.update({
        where: { id: run.id },
        data: {
          status: 'completed',
          fixturesAnalyzed: fixtureResult.fixtures.length,
          picksGenerated: inserted,
          completedAt: new Date(),
        },
      });
      return { inserted, completed: updated };
    });

    logger.info('analysis.run.completed', {
      runId: completed.id,
      fixturesAnalyzed: completed.fixturesAnalyzed,
      picksGenerated: completed.picksGenerated,
    });

    return {
      runId: completed.id,
      status: 'completed',
      fixturesAnalyzed: completed.fixturesAnalyzed,
      picksGenerated: completed.picksGenerated,
      errors: [...readinessErrors, ...fixtureResult.errors, ...enriched.flatMap((item) => item.enrichment.errors ?? [])],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error('analysis.run.failed', { runId: run.id, error: message });
    await prisma.analysisRun.update({
      where: { id: run.id },
      data: { status: 'failed', errorMessage: message.slice(0, 2000), completedAt: new Date() },
    });
    throw err;
  } finally {
    if (hasLock) {
      try {
        await redis.del(lockKey);
      } catch (err) {
        logger.warn('analysis.lock.releaseFailed', { runId: run.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }
}

export interface FixtureScoreInput {
  fixture: Fixture;
  enrichment: FixtureEnrichment;
}

/** `${provider}:${bookmaker}` provenance for captured odds, or undefined. */
function oddsSourceOf(enrichment: FixtureEnrichment): string | undefined {
  const odds = enrichment.odds;
  if (!odds) return undefined;
  const parts = [odds.provider, odds.bookmaker].filter(Boolean);
  return parts.length > 0 ? parts.join(':') : undefined;
}
