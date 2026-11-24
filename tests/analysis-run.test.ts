import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analysisRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  analysisResult: { createMany: vi.fn(), findMany: vi.fn() },
  analysisConfig: { findMany: vi.fn() },
  transaction: vi.fn(),
  redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), eval: vi.fn() },
  tx: {
    analysisResult: { createMany: vi.fn() },
    analysisRun: { update: vi.fn() },
  },
  fetchFixtures: vi.fn(),
  enrichFixtures: vi.fn(),
  getEnabledLeagues: vi.fn(),
  scoreFixture: vi.fn(),
}));

// Deterministic execution budget: the Nth `expired()` check reports whether the
// invocation budget is spent. `expireAfterCalls = 1` lets a single batch run to
// completion; a higher number defers after that many batch checkpoints.
const budgetState = vi.hoisted(() => ({ expireAfterCalls: 1 }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    analysisRun: mocks.analysisRun,
    analysisResult: mocks.analysisResult,
    analysisConfig: mocks.analysisConfig,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/redis', () => ({ redis: mocks.redis }));
vi.mock('@/lib/analysis/ingestion/fixtures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analysis/ingestion/fixtures')>();
  return {
    ...actual,
    fetchFixtures: mocks.fetchFixtures,
    getEnabledLeagues: mocks.getEnabledLeagues,
  };
});
vi.mock('@/lib/analysis/ingestion/enrichment', () => ({ enrichFixtures: mocks.enrichFixtures }));
vi.mock('@/lib/analysis/engine', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analysis/engine')>();
  return { ...actual, scoreFixture: mocks.scoreFixture, filterPicks: (outcomes: unknown[]) => outcomes };
});
// Keep the real estimator but make the wall-clock budget deterministic.
vi.mock('@/lib/analysis/ingestion/budget', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/analysis/ingestion/budget')>();
  return {
    ...actual,
    createRunBudget: () => {
      let calls = 0;
      return {
        deadlineMs: 0,
        expired: () => {
          const expired = calls >= budgetState.expireAfterCalls;
          calls += 1;
          return expired;
        },
        remainingMs: () => 0,
      };
    },
  };
});

import { runDailyAnalysis } from '@/lib/analysis/run';
import type { AnalysisOutcome, Fixture, MarketType } from '@/types/analysis';

vi.mock('@/lib/api/provider-config', () => ({
  getProviderConfig: () => ({
    analysisMaxRuntimeMs: Number(process.env.PROVIDER_ANALYSIS_MAX_RUNTIME_MS) || 240000,
    analysisBatchSize: Number(process.env.PROVIDER_ANALYSIS_BATCH_SIZE) || 10,
    analysisMaxAttempts: Number(process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS) || 3,
    confidenceThreshold: 70,
    marketWeights: {},
    dataSourcePriorities: [],
    quotaFreshnessSeconds: 1800,
    quotaWarningThreshold: 0.7,
    quotaCriticalThreshold: 0.85,
    quotaStopThreshold: 0.95,
  }),
}));

const FIXTURE: Fixture = {
  id: 'fx-1',
  leagueCode: 'PL',
  leagueName: 'Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

const FIXTURE_B: Fixture = { ...FIXTURE, id: 'fx-b' };

// A healthy, fresh quota snapshot for the verified `/status` store, so the
// Stage 9 ingestion gate is satisfied for the runs exercised below. `now` in
// every test is 2026-11-22T06:00:00Z, well inside the 30-minute freshness window.
const HEALTHY_QUOTA = {
  provider: 'api-football' as const,
  plan: 'test',
  subscriptionEnd: null,
  dailyLimit: 7500,
  consumed: 100,
  remaining: 7400,
  lastCheckedAt: '2026-11-22T05:59:00.000Z',
  status: 'OK' as const,
  source: 'status-endpoint' as const,
};

function validOutcome(fixture: Fixture = FIXTURE): AnalysisOutcome {
  const best = {
    market: 'MATCH_RESULT' as MarketType,
    selection: `${fixture.homeTeam}`,
    odds: 1.91,
    oddsAvailable: true,
    confidence: 82,
    confidenceLabel: 'HEURISTIC_MODEL_SCORE',
    modelProbability: 0.55,
    factors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
    evidence: {
      label: 'VERIFIED' as const,
      dataQuality: 'PRIMARY_COMPLETE' as const,
      oddsAvailability: 'AVAILABLE' as const,
      strength: 1,
      sources: [] as string[],
    },
  };
  return {
    fixture,
    scores: [best],
    best,
    eligibility: [],
    dataQuality: 'PRIMARY_COMPLETE' as const,
    evidenceLabel: 'VERIFIED' as const,
    topFactors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
  };
}

const baseCheckpoint = {
  processedFixtureIds: ['fx-1'],
  fixturesAnalyzed: 1,
  picksGenerated: 1,
  completedBatches: 1,
  updatedAt: new Date().toISOString(),
};

describe('runDailyAnalysis persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetState.expireAfterCalls = 1;
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.del.mockResolvedValue(1);
    mocks.redis.incr.mockResolvedValue(1);
    mocks.redis.expire.mockResolvedValue(1);
    mocks.redis.eval.mockResolvedValue(1);
    // No stale runs to recover by default; lock CAS operations succeed.
    mocks.analysisRun.findMany.mockResolvedValue([]);
    // Default: Redis reachable, quota key healthy, circuit closed (null).
    mocks.redis.get.mockImplementation(async (key: string) =>
      key === 'provider:quota:api-football' ? HEALTHY_QUOTA : null,
    );
    mocks.analysisConfig.findMany.mockResolvedValue([]);
    mocks.analysisResult.findMany.mockResolvedValue([]);
    mocks.getEnabledLeagues.mockResolvedValue([
      { leagueName: 'English Premier League', leagueCode: 'PL', isEnabled: true, priority: 1 },
    ]);
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.enrichFixtures.mockResolvedValue([{ fixture: FIXTURE, enrichment: {} }]);
    mocks.scoreFixture.mockImplementation((fixture: Fixture) => validOutcome(fixture));
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mocks.tx));
    mocks.analysisRun.create.mockResolvedValue({ id: 'run-1', status: 'running' });
  });

  it('persists results and finalises the run inside a single transaction', async () => {
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: [expect.objectContaining({ runId: 'run-1', fixtureId: 'fx-1' })],
      }),
    );
    expect(mocks.tx.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'run-1' }, data: expect.objectContaining({ status: 'completed' }) }),
    );
    // The non-transactional update must not be used for the success path.
    expect(mocks.analysisRun.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed', picksGenerated: 1, fixturesAnalyzed: 1 });
  });

  it('rolls back and marks the run failed when result persistence throws', async () => {
    mocks.tx.analysisResult.createMany.mockRejectedValue(new Error('duplicate key value'));
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow('duplicate key value');

    // The transaction never completed, so the run must be marked failed (never completed).
    expect(mocks.tx.analysisRun.update).not.toHaveBeenCalled();
    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('re-uses an existing same-day run unless forced', async () => {
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'existing-run',
      status: 'completed',
      fixturesAnalyzed: 5,
      picksGenerated: 2,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    expect(result).toMatchObject({ runId: 'existing-run', status: 'completed', picksGenerated: 2 });
  });

  it('creates a new run when forced despite existing completed run', async () => {
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'existing-run',
      status: 'completed',
      fixturesAnalyzed: 5,
      picksGenerated: 2,
    });
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.runId).toBe('run-1');
    expect(mocks.analysisRun.create).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Stage 9: provider-protection pre-flight (ingestion gate)
// ---------------------------------------------------------------------------

describe('runDailyAnalysis Stage 9 gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetState.expireAfterCalls = 1;
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.del.mockResolvedValue(1);
    mocks.redis.incr.mockResolvedValue(1);
    mocks.redis.expire.mockResolvedValue(1);
    mocks.redis.eval.mockResolvedValue(1);
    mocks.analysisRun.findMany.mockResolvedValue([]);
    mocks.analysisRun.findFirst.mockResolvedValue(null);
    mocks.analysisConfig.findMany.mockResolvedValue([]);
    mocks.analysisResult.findMany.mockResolvedValue([]);
    mocks.getEnabledLeagues.mockResolvedValue([
      { leagueName: 'English Premier League', leagueCode: 'PL', isEnabled: true, priority: 1 },
    ]);
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.enrichFixtures.mockResolvedValue([{ fixture: FIXTURE, enrichment: {} }]);
    mocks.scoreFixture.mockImplementation((fixture: Fixture) => validOutcome(fixture));
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mocks.tx));
    mocks.analysisRun.create.mockResolvedValue({ id: 'run-1', status: 'running' });
  });

  it('blocks the run when Redis is unavailable', async () => {
    mocks.redis.get.mockRejectedValue(new Error('ECONNREFUSED'));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('blocked');
    expect(result.runId).toBeNull();
    expect(result.blockedReason).toMatch(/redis unavailable/i);
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.fetchFixtures).not.toHaveBeenCalled();
  });

  it('blocks the run when quota information is unknown (conservative policy)', async () => {
    mocks.redis.get.mockImplementation(async () => null); // no snapshot, circuit closed

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('blocked');
    expect(result.runId).toBeNull();
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
  });

  it('blocks the run when daily quota consumption reaches the stop threshold', async () => {
    mocks.redis.get.mockImplementation(async (key: string) =>
      key === 'provider:quota:api-football'
        ? { ...HEALTHY_QUOTA, consumed: 7400, dailyLimit: 7500, remaining: 100 }
        : null,
    );

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('blocked');
    expect(result.blockedReason).toMatch(/quota/i);
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
  });

  it('blocks the run when the provider circuit is open (cooldown)', async () => {
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === 'provider:quota:api-football') return HEALTHY_QUOTA;
      if (key === 'provider:circuit:open:api-football') return '1';
      return null;
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('blocked');
    expect(result.blockedReason).toMatch(/cooldown/i);
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §6: execution-time budget, resumable idempotent batches
// ---------------------------------------------------------------------------

describe('runDailyAnalysis atomic batch + checkpoint (M2)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    budgetState.expireAfterCalls = 1;
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.del.mockResolvedValue(1);
    mocks.redis.incr.mockResolvedValue(1);
    mocks.redis.expire.mockResolvedValue(1);
    mocks.redis.eval.mockResolvedValue(1);
    mocks.analysisRun.findMany.mockResolvedValue([]);
    // No same-day run exists unless a test overrides this (fresh run path).
    mocks.analysisRun.findFirst.mockResolvedValue(null);
    mocks.redis.get.mockImplementation(async (key: string) =>
      key === 'provider:quota:api-football' ? HEALTHY_QUOTA : null,
    );
    mocks.analysisConfig.findMany.mockResolvedValue([]);
    mocks.analysisResult.findMany.mockResolvedValue([]);
    mocks.getEnabledLeagues.mockResolvedValue([
      { leagueName: 'English Premier League', leagueCode: 'PL', isEnabled: true, priority: 1 },
    ]);
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.enrichFixtures.mockResolvedValue([{ fixture: FIXTURE, enrichment: {} }]);
    mocks.scoreFixture.mockImplementation((fixture: Fixture) => validOutcome(fixture));
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mocks.tx));
    mocks.analysisRun.create.mockResolvedValue({ id: 'run-1', status: 'running' });
  });

  /** A transaction double that records the order of operations so a failure can
   *  be injected at a specific stage (results write vs checkpoint write). */
  function transactionWithFailureAt(stage: 'results' | 'checkpoint') {
    mocks.tx.analysisResult.createMany.mockImplementation(async () => {
      if (stage === 'results') throw new Error('injected results failure');
      return { count: 1 };
    });
    mocks.tx.analysisRun.update.mockImplementation(async (args: { data: { checkpoint?: unknown } }) => {
      if (stage === 'checkpoint') throw new Error('injected checkpoint failure');
      return {
        id: 'run-1',
        status: 'completed',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: args.data.checkpoint ?? baseCheckpoint,
      };
    });
  }

  it('commits results AND the checkpoint together on success', async () => {
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    // Both writes happened inside the ONE transaction.
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.analysisRun.update).toHaveBeenCalledTimes(1);
    // The checkpoint written with the results records the processed fixture and
    // the cumulative counters, and the run is finalised in the same call.
    const updateArg = mocks.tx.analysisRun.update.mock.calls[0][0] as {
      data: {
        status?: string;
        checkpoint?: { processedFixtureIds: string[]; fixturesAnalyzed: number; picksGenerated: number; completedBatches: number };
      };
    };
    expect(updateArg.data.status).toBe('completed');
    expect(updateArg.data.checkpoint).toMatchObject({
      processedFixtureIds: ['fx-1'],
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      completedBatches: 1,
    });
    expect(result).toMatchObject({ status: 'completed', picksGenerated: 1, fixturesAnalyzed: 1 });
  });

  it('rolls back everything when the results write fails', async () => {
    transactionWithFailureAt('results');
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow(
      /injected results failure/,
    );

    // Neither the checkpoint nor the status update ran (the tx aborted before
    // reaching them), and the run is marked failed — never completed.
    expect(mocks.tx.analysisRun.update).not.toHaveBeenCalled();
    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('rolls back everything when the checkpoint write fails (after results)', async () => {
    // Results insert succeeds, but the checkpoint update throws: the whole
    // transaction must roll back so results are NOT committed without a
    // matching checkpoint.
    transactionWithFailureAt('checkpoint');
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow(
      /injected checkpoint failure/,
    );

    // The run is marked failed, never completed, and no partial success leaks.
    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('does not create duplicate results when a batch is retried', async () => {
    // Two fixtures, batch size 1, budget allows a single batch then defers.
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE_B], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'running',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'deferred' });

    try {
      await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      // createMany is idempotent via skipDuplicates (the (runId, fixtureId)
      // unique index). The write must always request skipDuplicates so a retry
      // of the same batch can never insert a duplicate row.
      expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
      // The first batch's checkpoint records exactly the fixtures it committed.
      const cp = (mocks.tx.analysisRun.update.mock.calls[0][0] as {
        data: { checkpoint: { processedFixtureIds: string[] } };
      }).data.checkpoint;
      expect(cp.processedFixtureIds).toEqual(['fx-1']);
    } finally {
      delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    }
  });

  it('resumes from the durable checkpoint and does not reprocess committed fixtures', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 2; // allow two batches
    // First run: processes fx-1, then budget expires -> deferred
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE_B], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      })
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'deferred' });

    await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    // Second run (resume): should skip fx-1 and process fx-b
    budgetState.expireAfterCalls = 1;
    // findFirst returns the deferred run
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'deferred',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
    });
    // analysisResult.findMany returns the already-persisted result for fx-1
    mocks.analysisResult.findMany.mockResolvedValue([
      { fixtureId: 'fx-1', enrichmentQuality: 'PRIMARY_COMPLETE' },
    ]);
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 2,
      picksGenerated: 2,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-b'], fixturesAnalyzed: 2, picksGenerated: 2 },
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    expect(result.status).toBe('completed');
    expect(result.fixturesAnalyzed).toBe(2);
    expect(result.picksGenerated).toBe(2);
    // The resumed run's checkpoint should include both fixtures
    // First run made 2 update calls, second run makes 1 -> index 2
    const resumeCp = (mocks.tx.analysisRun.update.mock.calls[2][0] as {
      data: { checkpoint: { processedFixtureIds: string[] } };
    }).data.checkpoint;
    expect(resumeCp.processedFixtureIds).toEqual(['fx-1', 'fx-b']);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('does not double-count picks when createMany skips a duplicate', async () => {
    // Simulate a retry where the first fixture was already persisted.
    // With a fresh run (force: true), if createMany returns 0 (duplicate skipped),
    // the absolute counter correctly reflects 0 picks generated in this run.
    // The key assertion is that the counter is absolute, not an increment.
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.enrichFixtures.mockResolvedValue([{ fixture: FIXTURE, enrichment: {} }]);
    // createMany returns count: 0 because the row already exists (skipDuplicates)
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 0, // no rows inserted -> 0 picks
      checkpoint: baseCheckpoint,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.picksGenerated).toBe(0);
    // The update must use absolute counters, not { increment: 1 }
    const updateArg = mocks.tx.analysisRun.update.mock.calls[0][0] as {
      data: { picksGenerated: number | { increment: number } };
    };
    expect(typeof updateArg.data.picksGenerated).toBe('number');
    expect(updateArg.data.picksGenerated).toBe(0);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('records the correct processed fixture IDs in the checkpoint even when picksGenerated does not grow', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 2;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE_B], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    // First batch: fx-1 succeeds (1 pick)
    mocks.tx.analysisResult.createMany
      .mockResolvedValueOnce({ count: 1 })
      // Second batch: fx-b has no pick (e.g. below threshold) -> count: 0
      .mockResolvedValueOnce({ count: 0 });
    mocks.tx.analysisRun.update
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      })
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'completed',
        fixturesAnalyzed: 2,
        picksGenerated: 1, // picksGenerated did not grow (0 inserted)
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-b'], fixturesAnalyzed: 2, picksGenerated: 1 },
      });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('completed');
    expect(result.fixturesAnalyzed).toBe(2);
    expect(result.picksGenerated).toBe(1);
    // The checkpoint still records the newly-processed fixture id.
    const updateArg = mocks.tx.analysisRun.update.mock.calls[1][0] as {
      data: {
        fixturesAnalyzed: number;
        picksGenerated: number;
        checkpoint?: { fixturesAnalyzed: number; picksGenerated: number; processedFixtureIds: string[] };
      };
    };
    expect(updateArg.data.picksGenerated).toBe(1);
    expect(updateArg.data.checkpoint?.picksGenerated).toBe(1);
    expect(updateArg.data.checkpoint?.processedFixtureIds).toContain('fx-b');
    // Row and checkpoint agree.
    expect(updateArg.data.checkpoint?.fixturesAnalyzed).toBe(updateArg.data.fixturesAnalyzed);
    expect(updateArg.data.checkpoint?.picksGenerated).toBe(updateArg.data.picksGenerated);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });
});