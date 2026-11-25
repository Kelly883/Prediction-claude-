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

export interface RunLockState {
  /** Unique owner token for the lock holder, or null when not held. */
  owner: string | null;
  /** Interval handle for lock renewal; cleared when processing ends. */
  timer: ReturnType<typeof setInterval> | null;
  /** Set true when renewal loses ownership; processing must stop. */
  lost: boolean;
}

export function createRunLockState(): RunLockState {
  return { owner: null, timer: null, lost: false };
}

/** Redis key for the per-day analysis lock. */
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
export async function acquireAnalysisLock(state: RunLockState, day: string, ttlSeconds: number): Promise<string | null> {
  const token = randomUUID();
  try {
    const result = await redis.set(analysisLockKey(day), token, { nx: true, ex: ttlSeconds });
    if (result === 'OK') {
      state.owner = token;
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
export async function renewAnalysisLock(state: RunLockState, day: string, ttlSeconds: number): Promise<boolean> {
  if (!state.owner) return false;
  try {
    const lua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;
    const result = await redis.eval(lua, [analysisLockKey(day)], [state.owner, String(ttlSeconds)]);
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
export async function releaseAnalysisLock(state: RunLockState): Promise<void> {
  if (!state.owner) return;
  try {
    const lua = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
    await redis.eval(lua, [analysisLockKey(dateOnly(new Date()))], [state.owner]);
  } catch (err) {
    logger.warn('analysis.lock.releaseFailed', {
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    state.owner = null;
  }
}

/**
 * Start renewing the analysis lock every `renewalIntervalMs` milliseconds.
 * The interval is cleared by stopLockRenewal().
 */
export function startLockRenewal(state: RunLockState, day: string, ttlSeconds: number, renewalIntervalMs: number): void {
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(async () => {
    const ok = await renewAnalysisLock(state, day, ttlSeconds);
    if (!ok) {
      logger.warn('analysis.lock.renewalLost', { day });
      state.lost = true;
      stopLockRenewal(state);
    }
  }, renewalIntervalMs);
}

export function stopLockRenewal(state: RunLockState): void {
  if (state.timer) {
    clearInterval(state.timer);
    state.timer = null;
  }
}

// ---------------------------------------------------------------------------
// Stale-run recovery (H1)
//
// Recovers runs that were left `running` after a worker crash or invocation
// timeout. Uses a conditional update so a run that completed between the
// initial query and the update is never overwritten, and never recovers a run
// whose Redis day-lock is still held by an active worker.
// ---------------------------------------------------------------------------

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
export function isSuccessfullyAnalysed(outcome: { enrichmentQuality?: string | null; best?: { market: string; confidence: number } | undefined }): boolean {
  if (!outcome.best) return false;
  if (outcome.enrichmentQuality === 'INSUFFICIENT_DATA') return false;
  return true;
}

export interface AnalysisDependencies {
  fetchFixtures?: typeof fetchFixtures;
  enrichFixtures?: typeof enrichFixtures;
  scoreFixture?: typeof scoreFixture;
}

export async function recoverStaleRuns(staleThresholdMs: number = 15 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - staleThresholdMs);
  const stale = await prisma.analysisRun.findMany({
    where: { status: 'running', updatedAt: { lt: cutoff } },
    select: { id: true, runDate: true, updatedAt: true },
  });
  let recovered = 0;
  for (const run of stale) {
    // H1: never recover a run whose Redis day-lock is still held by an active
    // worker — that worker may simply be mid-batch.
    const dayLock = await redis.get(analysisLockKey(dateOnly(run.runDate)));
    if (dayLock !== null) {
      logger.info('analysis.run.staleSkipLockHeld', { runId: run.id, runDate: run.runDate });
      continue;
    }
    const result = await prisma.analysisRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: { status: 'failed', errorMessage: 'stale run recovered', completedAt: new Date() },
    });
    if (result.count === 1) {
      recovered += 1;
      logger.warn('analysis.run.staleRecovered', { runId: run.id, runDate: run.runDate, updatedAt: run.updatedAt });
      void incrProviderMetric('ingestion:staleRecovered');
    } else {
      logger.info('analysis.run.staleSkipAlreadyChanged', { runId: run.id, observedStatus: 'running' });
    }
  }
  return recovered;
}

export async function loadAnalysisSettings(): Promise<AnalysisSettings> {
  const configs = await prisma.analysisConfig.findMany({
    where: { key: { in: ['confidence_threshold', 'market_weights', 'data_source_priorities'] } },
    select: { key: true, value: true },
  });
  return parseStoredConfigs(configs.map((config) => ({ key: config.key, value: config.value })));
}

/**
 * Durable M2 resume checkpoint persisted alongside each batch's results.
 * Mirrors the `AnalysisRun.checkpoint` JSON column (see prisma/schema.prisma).
 * A `type` alias (not an interface) so it is assignable to Prisma's
 * `InputJsonValue` without casts.
 *
 * M6 write-amplification decision: retain the JSON checkpoint for the current
 * 20-league workload. `processedFixtureIds` is required for exact recovery
 * (it proves which fixtures were processed; a count cannot). Scale is bounded:
 * ~20 leagues x ~10 fixtures/day x ~5 markets = ~1000 IDs/day, each ~12 bytes,
 * so a full checkpoint is ~12 KB and is rewritten once per batch (~10-20
 * writes/day). That is negligible I/O and keeps recovery atomic with the
 * per-batch transaction. A dedicated table or per-batch rows would add joins
 * and migration cost without correctness benefit at this scale. Revisit if
 * fixture volume grows beyond ~10k IDs/checkpoint or batches exceed ~100/day.
 */
type AnalysisCheckpoint = {
  processedFixtureIds: string[];
  fixturesAnalyzed: number;
  picksGenerated: number;
  completedBatches: number;
  updatedAt: string;
};

/** Safely coerce a stored JSON checkpoint into a well-formed value. */
function normalizeCheckpoint(raw: Prisma.JsonValue | null | undefined): AnalysisCheckpoint | null {
  if (raw === null || raw === undefined || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  const obj = raw as Record<string, Prisma.JsonValue>;
  const processedFixtureIds = Array.isArray(obj.processedFixtureIds)
    ? obj.processedFixtureIds.filter((value): value is string => typeof value === 'string')
    : [];
  const fixturesAnalyzed = typeof obj.fixturesAnalyzed === 'number' ? obj.fixturesAnalyzed : 0;
  const picksGenerated = typeof obj.picksGenerated === 'number' ? obj.picksGenerated : 0;
  const completedBatches = typeof obj.completedBatches === 'number' ? obj.completedBatches : 0;
  const updatedAt = typeof obj.updatedAt === 'string' ? obj.updatedAt : new Date().toISOString();
  return { processedFixtureIds, fixturesAnalyzed, picksGenerated, completedBatches, updatedAt };
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
  await recoverStaleRuns();
  let resumeRunId: string | null = null;
  // Durable resume state: cumulative counters and the persisted checkpoint from
  // the deferred run we are continuing (zero/empty for a fresh run).
  let resumeFixturesAnalyzed = 0;
  let resumePicksGenerated = 0;
  let resumeCheckpoint: AnalysisCheckpoint | null = null;
  if (!options.force) {
    const existing = await prisma.analysisRun.findFirst({
      where: { runDate, status: { in: ['running', 'completed', 'deferred'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (existing && existing.status === 'deferred') {
      // Resume the deferred run: skip fixtures already persisted (durable
      // progress) and continue from where the budget stopped.
      resumeRunId = existing.id;
      resumeFixturesAnalyzed = existing.fixturesAnalyzed;
      resumePicksGenerated = existing.picksGenerated;
      resumeCheckpoint = normalizeCheckpoint(existing.checkpoint);
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
  const lockState = createRunLockState();
  let hasLock = false;
  try {
    const token = await acquireAnalysisLock(lockState, day, lockTtlSeconds);
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
    startLockRenewal(lockState, day, lockTtlSeconds, lockRenewalIntervalMs);
  }

  const providerConfig = getProviderConfig();
  const budget = createRunBudget(providerConfig.analysisMaxRuntimeMs);
  const batchSize = Math.max(1, providerConfig.analysisBatchSize);

  // Cumulative durable progress (M2). Seeded from the resumed run's persisted
  // counters/checkpoint so retries never double-count, then advanced per batch.
  let cumulativeFixtures = resumeFixturesAnalyzed;
  let cumulativePicks = resumePicksGenerated;
  let completedBatches = resumeCheckpoint?.completedBatches ?? 0;
  const processedFixtureIds: string[] = resumeCheckpoint ? [...resumeCheckpoint.processedFixtureIds] : [];

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
    // Only fixtures that were successfully analysed count toward the cumulative
    // tally; INSUFFICIENT_DATA / failed outcomes are excluded (see M1).
    const successfulAlreadyPersisted = new Set<string>();
    if (resumeRunId) {
      const persisted = await prisma.analysisResult.findMany({
        where: { runId: run.id },
        select: { fixtureId: true, enrichmentQuality: true },
      });
      for (const row of persisted) {
        alreadyPersisted.add(row.fixtureId);
        if (row.enrichmentQuality !== 'INSUFFICIENT_DATA') successfulAlreadyPersisted.add(row.fixtureId);
        // Keep the durable checkpoint in sync with what is actually persisted.
        if (!processedFixtureIds.includes(row.fixtureId)) processedFixtureIds.push(row.fixtureId);
      }
    }
    const pending = fixtureResult.fixtures.filter((fixture) => !alreadyPersisted.has(fixture.id));

    const errors: string[] = [...readinessErrors, ...fixtureResult.errors];

    // Every fixture already persisted (e.g. a completed resume) — finalise.
    // fixturesAnalyzed reflects the durable count already stored on the run;
    // we do NOT recount because previously processed fixtures are already
    // reflected in the run's persisted fixturesAnalyzed value.
    if (pending.length === 0) {
      const checkpoint: AnalysisCheckpoint = {
        processedFixtureIds: [...processedFixtureIds],
        fixturesAnalyzed: cumulativeFixtures,
        picksGenerated: cumulativePicks,
        completedBatches,
        updatedAt: new Date().toISOString(),
      };
      const completed = await prisma.$transaction((tx) =>
        tx.analysisRun.update({
          where: { id: run.id },
          data: { status: 'completed', completedAt: new Date(), checkpoint },
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

    // --- L2: Exhausted-run lifecycle ---
    // When every pending fixture has exhausted its retry allowance the run
    // reaches a clear terminal state (`failed`) instead of silently creating a
    // new run that would repeat all previous work. The run row, its audit
    // history and its persisted results are preserved. An intentional rerun is
    // requested explicitly via `force: true` (which starts a fresh run); the
    // daily cron continues to handle other eligible days/work unimpeded.
    if (retryablePending.length === 0 && pending.length > 0) {
      const checkpoint: AnalysisCheckpoint = {
        processedFixtureIds: [...processedFixtureIds],
        fixturesAnalyzed: cumulativeFixtures,
        picksGenerated: cumulativePicks,
        completedBatches,
        updatedAt: new Date().toISOString(),
      };
      // Atomic status transition guarded by the current `running` state so a
      // concurrent worker that already finalised the run is not clobbered.
      const runRow = await prisma.$transaction((tx) =>
        tx.analysisRun.update({
          where: { id: run.id, status: 'running' },
          data: {
            status: 'failed',
            errorMessage: `All ${pending.length} pending fixture(s) exhausted the ${maxAttempts}-attempt retry allowance`,
            completedAt: new Date(),
            checkpoint,
          },
        }),
      );
      void incrProviderMetric('ingestion:exhausted');
      return {
        runId: run.id,
        status: 'failed',
        fixturesAnalyzed: runRow.fixturesAnalyzed,
        picksGenerated: runRow.picksGenerated,
        errors,
      };
    }

    for (let index = 0; index < batches.length; index += 1) {
      // H2: losing ownership mid-run stops the worker from processing or
      // committing another batch.
      if (lockState.lost) break;

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
      const { inserted, updated, nextFixtures, nextPicks, nextCompletedBatches, nextProcessed } =
        await prisma.$transaction(async (tx) => {
          let inserted = 0;
          if (rows.length > 0) {
            const created = await tx.analysisResult.createMany({
              data: rows as unknown as Prisma.AnalysisResultCreateManyInput[],
              skipDuplicates: true,
            });
            inserted = created.count;
          }
          // Compute the next cumulative state from the pre-batch values. These
          // are only committed to the outer counters once the transaction
          // resolves, so a rolled-back batch never advances durable progress.
          const nextFixtures = cumulativeFixtures + successfulInBatch;
          // `inserted` already excludes duplicates skipped by the unique index,
          // so picksGenerated is never double-counted on a retried batch.
          const nextPicks = cumulativePicks + inserted;
          const nextCompletedBatches = completedBatches + 1;
          const nextProcessed = [...processedFixtureIds];
          for (const fixture of batch) {
            if (!nextProcessed.includes(fixture.id)) nextProcessed.push(fixture.id);
          }
          const checkpoint: AnalysisCheckpoint = {
            processedFixtureIds: nextProcessed,
            fixturesAnalyzed: nextFixtures,
            picksGenerated: nextPicks,
            completedBatches: nextCompletedBatches,
            updatedAt: new Date().toISOString(),
          };
          const updatedRow = await tx.analysisRun.update({
            where: { id: run.id },
            data: isLast
              ? {
                  status: 'completed',
                  completedAt: new Date(),
                  fixturesAnalyzed: nextFixtures,
                  picksGenerated: nextPicks,
                  checkpoint,
                }
              : {
                  fixturesAnalyzed: nextFixtures,
                  picksGenerated: nextPicks,
                  checkpoint,
                },
          });
          return {
            inserted,
            updated: updatedRow,
            nextFixtures,
            nextPicks,
            nextCompletedBatches,
            nextProcessed,
          };
        });
      cumulativeFixtures = nextFixtures;
      cumulativePicks = nextPicks;
      completedBatches = nextCompletedBatches;
      processedFixtureIds.splice(0, processedFixtureIds.length, ...nextProcessed);

      processed += batch.length;
      successfulThisRun += successfulInBatch;
      picksThisRun += inserted;
      errors.push(...enriched.flatMap((item) => item.enrichment.errors ?? []));
      if (isLast) completedRow = updated;
    }

    // H2: if ownership was lost mid-run, stop here — do not commit further
    // batches and do not report a successful/partial completion.
    if (lockState.lost) {
      const runRow = await prisma.analysisRun.update({
        where: { id: run.id },
        data: { status: 'failed', errorMessage: 'analysis lock lost mid-run; ownership revoked', completedAt: new Date() },
      });
      return {
        runId: run.id,
        status: 'failed',
        fixturesAnalyzed: runRow.fixturesAnalyzed,
        picksGenerated: runRow.picksGenerated,
        errors: [...errors, 'analysis lock lost mid-run'],
      };
    }

    if (deferred) {
      const remaining = pending.length - processed;
      // Durable deferral: per-batch counters were already committed; only the
      // status changes. A later invocation resumes this SAME run.
      // fixturesAnalyzed reflects cumulative successfully-analysed fixtures,
      // including those already persisted before this invocation. The status
      // transition and its checkpoint commit atomically, guarded by the current
      // `running` state so a concurrent finaliser is not clobbered.
      const checkpoint: AnalysisCheckpoint = {
        processedFixtureIds: [...processedFixtureIds],
        fixturesAnalyzed: cumulativeFixtures,
        picksGenerated: cumulativePicks,
        completedBatches,
        updatedAt: new Date().toISOString(),
      };
      const runRow = await prisma.$transaction((tx) =>
        tx.analysisRun.update({
          where: { id: run.id, status: 'running' },
          data: { status: 'deferred', checkpoint },
        }),
      );
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
        fixturesAnalyzed: runRow.fixturesAnalyzed,
        picksGenerated: runRow.picksGenerated,
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
    // Remove the partial run row so a failed invocation leaves no persisted
    // state behind (matches the integration test's no-partial-state contract).
    await prisma.analysisResult.deleteMany({ where: { runId: run.id } });
    await prisma.analysisRun.delete({ where: { id: run.id } }).catch(() => undefined);
    throw err;
  } finally {
    stopLockRenewal(lockState);
    if (hasLock) {
      await releaseAnalysisLock(lockState);
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
