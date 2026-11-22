import { randomUUID } from 'node:crypto';
import { prisma } from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { getProviderConfig } from '@/lib/api/provider-config';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { parseStoredConfigs } from './config';
import { filterPicks, scoreFixture } from './engine';
import { toPersistableResult } from './persistence';
import { enrichFixtures } from './ingestion/enrichment';
import { dateOnly, fetchFixtures, getEnabledLeagues } from './ingestion/fixtures';
import { evaluateIngestionGate } from './ingestion/gating';
import { assessAllLeagueReadiness, summarizeReadiness } from './ingestion/readiness';
import { createRunBudget, estimateRuntimeMs, runtimeInputs } from './ingestion/budget';
import type { AnalysisSettings, Fixture, FixtureEnrichment } from '@/types/analysis';

// ---------------------------------------------------------------------------
// Analysis run lock with owner token and lease renewal (H2)
//
// The distributed lock guards against concurrent analysis runs for the same
// day. It is acquired once at run start, renewed while the worker is actively
// processing, and released only by the owner. A stale-run recovery procedure
// (H1) can mark abandoned runs failed using a conditional update so a run that
// completed between discovery and recovery is never overwritten.
// ---------------------------------------------------------------------------

/** Unique owner token for the current analysis lock holder. Generated once per run. */
let analysisLockOwner: string | null = null;

/** Interval handle for lock renewal; cleared when processing ends. */
let lockRenewalTimer: ReturnType<typeof setInterval> | null = null;

/** Redis key prefix for the per-day analysis lock. */
function analysisLockKey(day: string): string {
  return `analysis:daily:${day}`;
}

/**
 * Redis key prefix for per-fixture attempt tracking (daily, TTL 24h).
 */
function fixtureAttemptKey(fixtureId: string): string {
  return `analysis:fixture:attempts:${fixtureId}`;
}

/**
 * Increment and return the attempt count for a fixture. Fails closed on Redis
 * error (cannot track attempts → skip the fixture to avoid unbounded retries).
 */
async function incrementFixtureAttempt(fixtureId: string, maxAttempts: number): Promise<number> {
  try {
    const count = await redis.incr(fixtureAttemptKey(fixtureId));
    if (count === 1) {
      await redis.expire(fixtureAttemptKey(fixtureId), 86_400);
    }
    return Number(count);
  } catch (err) {
    logger.warn('analysis.fixture.attemptTrackFailed', {
      fixtureId,
      error: err instanceof Error ? err.message : String(err),
    });
    return maxAttempts + 1; // treat as exceeded to avoid unbounded retries
  }
}

/**
 * Read the current attempt count for a fixture (0 if never attempted).
 */
async function readFixtureAttempt(fixtureId: string): Promise<number> {
  try {
    const raw = await redis.get(fixtureAttemptKey(fixtureId));
    const n = raw === null || raw === undefined ? 0 : Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

/**
 * Acquire the per-day analysis lock with a unique owner token.
 * Returns the token when acquired, null otherwise. Fails closed on Redis error.
 */
async function acquireAnalysisLock(day: string, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID();
  try {
    const result = await redis.set(analysisLockKey(day), token, { nx: true, ex: ttlSeconds });
    if (result === 'OK') {
      analysisLockOwner = token;
      return token;
    }
    return null;
  } catch (err) {
    logger.warn('analysis.lock.acquireFailed', {
      day,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Renew the analysis lock only if the stored owner token matches ours.
 * Uses a Lua compare-and-set so a worker can never renew another worker's lock.
 */
async function renewAnalysisLock(day: string, ttlSeconds: number): Promise<boolean> {
  if (!analysisLockOwner) return false;
  try {
    const lua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
    const result = await redis.eval(lua, [analysisLockKey(day)], [analysisLockOwner, String(ttlSeconds)]);
    return Number(result) === 1;
  } catch (err) {
    logger.warn('analysis.lock.renewFailed', {
      day,
      error: err instanceof Error ? err.message : String(err),
    });
    return false;
  }
}

/**
 * Release the analysis lock only if we still own it (compare-and-delete).
 * Never deletes a lock owned by another worker.
 */
async function releaseAnalysisLock(): Promise<void> {
  if (!analysisLockOwner) return;
  try {
    const lua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
    await redis.eval(lua, [analysisLockKey(dateOnly(new Date()))], [analysisLockOwner]);
  } catch (err) {
    logger.warn('analysis.lock.releaseFailed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    analysisLockOwner = null;
  }
}

/**
 * Start renewing the analysis lock every `renewalIntervalMs` milliseconds.
 * The interval is cleared by stopLockRenewal().
 */
function startLockRenewal(day: string, ttlSeconds: number, renewalIntervalMs: number): void {
  if (lockRenewalTimer) clearInterval(lockRenewalTimer);
  lockRenewalTimer = setInterval(async () => {
    const ok = await renewAnalysisLock(day, ttlSeconds);
    if (!ok) {
      logger.warn('analysis.lock.renewalLost', { day });
      stopLockRenewal();
    }
  }, renewalIntervalMs);
}

function stopLockRenewal(): void {
  if (lockRenewalTimer) {
    clearInterval(lockRenewalTimer);
    lockRenewalTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Stale-run recovery (H1)
//
// Recovers runs that were left `running` after a worker crash or invocation
// timeout. Uses a conditional update so a run that completed between the
// initial query and the update is never overwritten.
// ---------------------------------------------------------------------------

/**
 * Recover stale analysis runs that have been `running` longer than the
 * stale threshold. Only transitions a run from `running` → `failed`; a run
 * that is already `completed`, `deferred`, or `failed` is never touched.
 * Returns the number of runs actually recovered.
 *
 * The conditional `updateMany` ensures we never overwrite a run whose status
 * changed between the discovery query and the update (e.g. a worker finished
 * and committed `completed` just before recovery ran).
 */
export async function recoverStaleRuns(staleThresholdMs: number): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMs);
  const stale = await prisma.analysisRun.findMany({
    where: {
      status: 'running',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, runDate: true, updatedAt: true },
  });

  let recovered = 0;
  for (const run of stale) {
    const result = await prisma.analysisRun.updateMany({
      where: {
        id: run.id,
        status: 'running',
      },
      data: {
        status: 'failed',
        errorMessage:
          'Stale-run recovery: run was left running beyond the stale threshold without completing',
        completedAt: new Date(),
      },
    });
    if (result.count === 1) {
      recovered += 1;
      logger.warn('analysis.run.staleRecovered', {
        runId: run.id,
        runDate: run.runDate,
        updatedAt: run.updatedAt,
      });
      void incrProviderMetric('ingestion:staleRecovered');
    } else {
      logger.info('analysis.run.staleSkipAlreadyChanged', {
        runId: run.id,
        observedStatus: 'running',
      });
    }
  }
  return recovered;
}

export interface DailyRunResult {
  /** Null when the run was blocked before a row was created (Stage 9 gating). */
  runId: string | null;
  /**
   * `deferred` means the invocation hit its execution budget after durably
   * persisting what it processed; a later invocation resumes the SAME run. A
   * deferred run is explicitly NOT a completed run and must not be presented as
   * a successful full analysis.
   */
  status: 'completed' | 'failed' | 'running' | 'blocked' | 'deferred';
  fixturesAnalyzed: number;
  picksGenerated: number;
  alreadyRunning?: boolean;
  errors?: string[];
  /** Populated when `status === 'blocked'`: why automated ingestion was refused. */
  blockedReason?: string;
}

/**
 * A fixture outcome counts as successfully analysed only when it has a
 * selectable best market AND its enrichment quality is not INSUFFICIENT_DATA.
 * Fixtures with INSUFFICIENT_DATA enrichment are explicitly excluded — they
 * have no reliable evidence for any market and must never be presented as
 * analysed.
 */
function isSuccessfullyAnalysed(outcome: { enrichmentQuality?: string | null; best?: { market: string; confidence: number } | undefined }): boolean {
  if (!outcome.best) return false;
  if (outcome.enrichmentQuality === 'INSUFFICIENT_DATA') return false;
  return true;
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
  // A `deferred` run (previous invocation hit its execution budget) is RESUMED.
  // Re-runs are an intentional product feature, so we deliberately do NOT add a
  // unique constraint on `AnalysisRun.runDate` — instead callers must pass
  // `force: true` to start an additional run. Duplicate fixtures *within* a run
  // are prevented by the unique `AnalysisResult(runId, fixtureId)` index.
  let resumeRunId: string | null = null;
  if (!options.force) {
    const existing = await prisma.analysisRun.findFirst({
      where: { runDate, status: { in: ['running', 'completed', 'deferred'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.status === 'deferred') {
      // Resume the deferred run: skip fixtures already persisted (durable
      // progress) and continue from where the budget stopped.
      resumeRunId = existing.id;
    } else if (existing) {
      return {
        runId: existing.id,
        status: existing.status as 'completed' | 'running',
        fixturesAnalyzed: existing.fixturesAnalyzed,
        picksGenerated: existing.picksGenerated,
        alreadyRunning: existing.status === 'running',
      };
    }
  }

  // Stage 9: provider-protection pre-flight. Before starting a run we confirm
  // that Redis (shared limiter/lock/quota store) is reachable, the daily quota
  // is known and sufficient, and the provider is not in a cooldown. A blocked
  // gate creates no run, preserves existing data and never completes as success.
  const gate = await evaluateIngestionGate({ now });
  if (!gate.ok) {
    logger.warn('analysis.run.blocked', { day, reasons: gate.reasons, quotaLevel: gate.quotaLevel });
    void incrProviderMetric('ingestion:blocked');
    return {
      runId: null,
      status: 'blocked',
      fixturesAnalyzed: 0,
      picksGenerated: 0,
      blockedReason: gate.reasons.join('; '),
    };
  }

  const lockTtlSeconds = 600;
  const lockRenewalIntervalMs = 30_000; // renew every 30s, well within 600s TTL
  let hasLock = false;
  try {
    const token = await acquireAnalysisLock(day, lockTtlSeconds);
    hasLock = token !== null;
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
  if (resumeRunId) {
    // Resume a deferred run: flip it back to `running` (the Redis day-lock
    // serialises resumes) and continue from durable progress below.
    run = { id: resumeRunId };
    await prisma.analysisRun.update({ where: { id: run.id }, data: { status: 'running' } });
    logger.info('analysis.run.resumed', { runId: run.id, day });
  } else {
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
  }

  // Start lock renewal now that we hold the lock and are actively processing
  // (covers both new runs and resumed deferred runs).
  if (hasLock) {
    startLockRenewal(day, lockTtlSeconds, lockRenewalIntervalMs);
  }

  const providerConfig = getProviderConfig();
  const budget = createRunBudget(providerConfig.analysisMaxRuntimeMs);
  const batchSize = Math.max(1, providerConfig.analysisBatchSize);

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

    // CALCULATED worst-case runtime (see lib/analysis/ingestion/budget.ts). Logged
    // per run so operators can see whether the workload fits the invocation
    // budget BEFORE provider traffic is issued.
    const estimate = estimateRuntimeMs(runtimeInputs(fixtureResult.fixtures.length, providerConfig));
    logger.info('analysis.run.budget', {
      runId: run.id,
      fixtures: fixtureResult.fixtures.length,
      estimatedMs: estimate.estimatedMs,
      budgetMs: providerConfig.analysisMaxRuntimeMs,
      fitsBudget: estimate.estimatedMs <= providerConfig.analysisMaxRuntimeMs,
      effectiveRps: estimate.effectiveRps,
    });

    // Durable progress: when resuming, skip fixtures already persisted (the
    // (runId, fixtureId) unique index makes per-batch writes idempotent anyway).
    const alreadyPersisted = new Set<string>();
    if (resumeRunId) {
      const persisted = await prisma.analysisResult.findMany({
        where: { runId: run.id },
        select: { fixtureId: true },
      });
      for (const row of persisted) alreadyPersisted.add(row.fixtureId);
    }
    const pending = fixtureResult.fixtures.filter((fixture) => !alreadyPersisted.has(fixture.id));

    const errors: string[] = [...readinessErrors, ...fixtureResult.errors];

    // Every fixture already persisted (e.g. a completed resume) — finalise.
    // fixturesAnalyzed reflects the durable count already stored on the run;
    // we do NOT recount because previously processed fixtures are already
    // reflected in the run's persisted fixturesAnalyzed value.
    if (pending.length === 0) {
      const completed = await prisma.$transaction((tx) =>
        tx.analysisRun.update({
          where: { id: run.id },
          data: { status: 'completed', completedAt: new Date() },
        }),
      );
      logger.info('analysis.run.completed', {
        runId: completed.id,
        fixturesAnalyzed: completed.fixturesAnalyzed,
        picksGenerated: completed.picksGenerated,
      });
      void incrProviderMetric('ingestion:completed');
      return {
        runId: completed.id,
        status: 'completed',
        fixturesAnalyzed: completed.fixturesAnalyzed,
        picksGenerated: completed.picksGenerated,
        errors,
      };
    }

    // --- L1: Per-fixture retry policy ---
    // Exclude fixtures that have exhausted their max analysis attempts so they
    // are not retried indefinitely. Track attempts in Redis with a 24h TTL.
    const maxAttempts = providerConfig.analysisMaxAttempts;
    const excludedFixtureIds = new Set<string>();
    const retryablePending: Fixture[] = [];
    for (const fixture of pending) {
      const attempts = await readFixtureAttempt(fixture.id);
      if (attempts >= maxAttempts) {
        excludedFixtureIds.add(fixture.id);
        errors.push(
          `fixture ${fixture.id}: excluded after ${maxAttempts} failed analysis attempts`,
        );
      } else {
        retryablePending.push(fixture);
      }
    }

    const batches = chunk(retryablePending, batchSize);
    let processed = 0;
    let successfulThisRun = 0;
    let picksThisRun = 0;
    let deferred = false;
    let completedRow: { id: string; fixturesAnalyzed: number; picksGenerated: number } | null = null;

    for (let index = 0; index < batches.length; index += 1) {
      // Checkpoint BEFORE each batch: if the invocation budget is spent we
      // DEFER the remainder. We never truncate the fixture list silently and
      // never publish partial results as a successful full run.
      if (budget.expired()) {
        deferred = true;
        break;
      }

      const batch = batches[index];
      const isLast = index === batches.length - 1;

      // Increment attempt counters for each fixture in this batch before
      // enrichment/scoring so a crash mid-batch still records the attempt.
      for (const fixture of batch) {
        await incrementFixtureAttempt(fixture.id, maxAttempts);
      }

      const enriched = await enrich(batch, settings);
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

      // Count only successfully analysed fixtures: a selectable best market
      // AND enrichment quality is not INSUFFICIENT_DATA.
      const successfulInBatch = outcomes.filter(isSuccessfullyAnalysed).length;

      // Validate + map before touching the database so a malformed payload fails
      // the batch before any rows are written.
      const rows = picks.map((pick) => toPersistableResult(run.id, pick));

      // Atomic per-batch finalisation: result persistence and the durable
      // progress counters commit together (or roll back together). The final
      // batch additionally marks the run `completed` in the SAME transaction.
      // `skipDuplicates` keeps the write retry-safe against the unique
      // `(runId, fixtureId)` index.
      const { inserted, updated } = await prisma.$transaction(async (tx) => {
        let inserted = 0;
        if (rows.length > 0) {
          const created = await tx.analysisResult.createMany({
            data: rows as unknown as Prisma.AnalysisResultCreateManyInput[],
            skipDuplicates: true,
          });
          inserted = created.count;
        }
        const updatedRow = await tx.analysisRun.update({
          where: { id: run.id },
          data: isLast
            ? {
                status: 'completed',
                completedAt: new Date(),
                fixturesAnalyzed: { increment: successfulInBatch },
                picksGenerated: { increment: inserted },
              }
            : {
                fixturesAnalyzed: { increment: successfulInBatch },
                picksGenerated: { increment: inserted },
              },
        });
        return { inserted, updated: updatedRow };
      });

      processed += batch.length;
      successfulThisRun += successfulInBatch;
      picksThisRun += inserted;
      errors.push(...enriched.flatMap((item) => item.enrichment.errors ?? []));
      if (isLast) completedRow = updated;
    }

    if (deferred) {
      const remaining = pending.length - processed;
      // Durable deferral: per-batch counters were already committed; only the
      // status changes. A later invocation resumes this SAME run.
      // fixturesAnalyzed reflects cumulative successfully-analysed fixtures,
      // including those already persisted before this invocation.
      await prisma.analysisRun.update({ where: { id: run.id }, data: { status: 'deferred' } });
      logger.warn('analysis.run.deferred', {
        runId: run.id,
        processed,
        successfulThisRun,
        totalPending: pending.length,
        remaining,
        budgetMs: providerConfig.analysisMaxRuntimeMs,
      });
      void incrProviderMetric('ingestion:deferred');
      return {
        runId: run.id,
        status: 'deferred',
        fixturesAnalyzed: alreadyPersisted.size + successfulThisRun,
        picksGenerated: picksThisRun,
        blockedReason: `execution budget (${providerConfig.analysisMaxRuntimeMs}ms) exhausted after ${processed}/${pending.length} pending fixture(s); ${remaining} deferred to the next invocation`,
        errors,
      };
    }

    if (!completedRow) {
      // Unreachable: a non-empty pending set always yields at least one batch.
      throw new Error('analysis run produced no batches for a non-empty pending set');
    }

    logger.info('analysis.run.completed', {
      runId: completedRow.id,
      fixturesAnalyzed: completedRow.fixturesAnalyzed,
      picksGenerated: completedRow.picksGenerated,
    });
    void incrProviderMetric('ingestion:completed');
    return {
      runId: completedRow.id,
      status: 'completed',
      fixturesAnalyzed: completedRow.fixturesAnalyzed,
      picksGenerated: completedRow.picksGenerated,
      errors,
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
    stopLockRenewal();
    if (hasLock) {
      await releaseAnalysisLock();
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

/** Split `items` into consecutive batches of at most `size` (size >= 1). */
function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
