import { prisma } from '@/lib/prisma';
import { redis } from '@/lib/redis';
import { parseStoredConfigs } from './config';
import { filterPicks, scoreFixture } from './engine';
import { enrichFixtures } from './ingestion/enrichment';
import { dateOnly, fetchFixtures, getEnabledLeagues } from './ingestion/fixtures';
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
    console.warn('Analysis lock unavailable, continuing without distributed lock', err);
    hasLock = true;
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

  const run = await prisma.analysisRun.create({
    data: { runDate, status: 'running', startedAt: now },
  });

  try {
    const settings = await loadAnalysisSettings();
    const leagues = await getEnabledLeagues();
    const fixtureResult = await loadFixtures(leagues, settings, now);
    const enriched = await enrich(fixtureResult.fixtures, settings);
    const outcomes = enriched.map(({ fixture, enrichment }) => score(fixture, enrichment, settings));
    const picks = filterPicks(outcomes, settings.threshold);

    if (picks.length > 0) {
      await prisma.analysisResult.createMany({
        data: picks.map((pick) => ({
          runId: run.id,
          fixtureId: pick.fixture.id,
          homeTeam: pick.fixture.homeTeam,
          awayTeam: pick.fixture.awayTeam,
          league: pick.fixture.leagueCode,
          kickoff: pick.fixture.kickoff,
          bestMarket: pick.best.market,
          bestSelection: pick.best.selection,
          bestOdds: pick.best.odds,
          confidence: pick.best.confidence,
          marketScores: pick.scores as unknown as object,
          topFactors: pick.topFactors as unknown as object,
        })),
      });
    }

    const completed = await prisma.analysisRun.update({
      where: { id: run.id },
      data: {
        status: 'completed',
        fixturesAnalyzed: fixtureResult.fixtures.length,
        picksGenerated: picks.length,
        completedAt: new Date(),
      },
    });

    return {
      runId: completed.id,
      status: 'completed',
      fixturesAnalyzed: completed.fixturesAnalyzed,
      picksGenerated: completed.picksGenerated,
      errors: [...fixtureResult.errors, ...enriched.flatMap((item) => item.enrichment.errors ?? [])],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
        console.warn('Analysis lock release failed', err);
      }
    }
  }
}

export interface FixtureScoreInput {
  fixture: Fixture;
  enrichment: FixtureEnrichment;
}
