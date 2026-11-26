import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted but create fresh mocks per file to avoid cross-file leakage
const mocks = vi.hoisted(() => {
  return {
    analysisRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), findMany: vi.fn() },
    analysisResult: { createMany: vi.fn(), findMany: vi.fn() },
    analysisConfig: { findMany: vi.fn() },
    user: { findMany: vi.fn() },
    transaction: vi.fn(),
    redis: { get: vi.fn(), set: vi.fn(), del: vi.fn(), incr: vi.fn(), expire: vi.fn(), eval: vi.fn() },
    tx: {
      analysisResult: { createMany: vi.fn(), findUnique: vi.fn() },
      analysisRun: { update: vi.fn(), updateMany: vi.fn() },
    },
    fetchFixtures: vi.fn(),
    enrichFixtures: vi.fn(),
    getEnabledLeagues: vi.fn(),
    scoreFixture: vi.fn(),
    sendEmail: vi.fn(),
  };
});

const budgetState = vi.hoisted(() => ({ expireAfterCalls: 1 }));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    analysisRun: mocks.analysisRun,
    analysisResult: mocks.analysisResult,
    analysisConfig: mocks.analysisConfig,
    user: mocks.user,
    $transaction: mocks.transaction,
  },
}));
vi.mock('@/lib/redis', () => ({ redis: mocks.redis }));
vi.mock('@/lib/email', () => ({ sendEmail: mocks.sendEmail }));
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

import type { AnalysisOutcome, Fixture, MarketType } from '@/types/analysis';

let runDailyAnalysis: any;

beforeAll(async () => {
  // Clear any modules cached by prior test files so vi.mock() factories
  // below are applied fresh to @/lib/analysis/run and its dependencies.
  // Prevents cross-file mock pollution from other suites mocking @/lib/prisma.
  vi.resetModules();
  const mod = await import('@/lib/analysis/run');
  runDailyAnalysis = mod.runDailyAnalysis;
});

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

function createRunRow(overrides: Partial<{
  id: string;
  status: string;
  fixturesAnalyzed: number;
  picksGenerated: number;
  checkpoint: typeof baseCheckpoint;
}> = {}) {
  return {
    id: 'run-1',
    status: 'completed',
    fixturesAnalyzed: 1,
    picksGenerated: 1,
    checkpoint: baseCheckpoint,
    ...overrides,
  };
}

function setupDefaultMocks() {
  vi.resetAllMocks();
  delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  budgetState.expireAfterCalls = 1;
  mocks.redis.set.mockResolvedValue('OK');
  mocks.redis.del.mockResolvedValue(1);
  mocks.redis.incr.mockResolvedValue(1);
  mocks.redis.expire.mockResolvedValue(1);
  mocks.redis.eval.mockResolvedValue(1);
  mocks.analysisRun.findMany.mockResolvedValue([]);
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
  mocks.analysisRun.update.mockResolvedValue(createRunRow({ status: 'failed' }));
  mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => cb(mocks.tx));
  mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
  mocks.tx.analysisRun.updateMany.mockResolvedValue({ count: 1 });
  mocks.tx.analysisResult.findUnique.mockResolvedValue(null);
  mocks.sendEmail.mockResolvedValue(undefined);
  mocks.user.findMany.mockResolvedValue([]);
}

// ============================================================
// Persistence tests
// ============================================================
describe('runDailyAnalysis persistence', () => {
  beforeEach(setupDefaultMocks);

  it('persists results and finalises the run inside a single transaction', async () => {
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    }));

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
    expect(mocks.analysisRun.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'completed', picksGenerated: 1, fixturesAnalyzed: 1 });
  });

  it('rolls back and marks the run failed when result persistence throws', async () => {
    mocks.tx.analysisResult.createMany.mockRejectedValue(new Error('duplicate key value'));
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow('duplicate key value');

    expect(mocks.tx.analysisRun.update).not.toHaveBeenCalled();
    expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'run-1', status: 'running' }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
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
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    }));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.runId).toBe('run-1');
    expect(mocks.analysisRun.create).toHaveBeenCalled();
  });
});

// ============================================================
// Stage 9: provider-protection pre-flight (ingestion gate)
// ============================================================

describe('runDailyAnalysis Stage 9 gating', () => {
  beforeEach(setupDefaultMocks);

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
    mocks.redis.get.mockImplementation(async () => null);

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

// ============================================================
// §6: execution-time budget, resumable idempotent batches (M2)
// ============================================================

describe('runDailyAnalysis atomic batch + checkpoint (M2)', () => {
  beforeEach(setupDefaultMocks);

  function transactionWithFailureAt(stage: 'results' | 'checkpoint') {
    mocks.tx.analysisResult.createMany.mockImplementation(async () => {
      if (stage === 'results') throw new Error('injected results failure');
      return { count: 1 };
    });
    mocks.tx.analysisRun.update.mockImplementation(async (args: { data: { checkpoint?: typeof baseCheckpoint } }) => {
      if (stage === 'checkpoint') throw new Error('injected checkpoint failure');
      return createRunRow({
        status: 'completed',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: args.data.checkpoint ?? baseCheckpoint,
      });
    });
  }

  it('commits results AND the checkpoint together on success', async () => {
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    }));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledTimes(1);
    expect(mocks.tx.analysisRun.update).toHaveBeenCalledTimes(1);
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
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow(
      /injected results failure/,
    );

    expect(mocks.tx.analysisRun.update).not.toHaveBeenCalled();
    expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'run-1', status: 'running' }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('rolls back everything when the checkpoint write fails (after results)', async () => {
    transactionWithFailureAt('checkpoint');
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') })).rejects.toThrow(
      /injected checkpoint failure/,
    );

    expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'run-1', status: 'running' }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('does not create duplicate results when a batch is retried', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE_B], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'running',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    }));
    mocks.analysisRun.update.mockResolvedValue(createRunRow({ status: 'deferred' }));

    try {
      await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledWith(
        expect.objectContaining({ skipDuplicates: true }),
      );
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
    budgetState.expireAfterCalls = 2;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE_B], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update
      .mockResolvedValueOnce(createRunRow({
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      }))
      .mockResolvedValueOnce(createRunRow({
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      }));
    mocks.analysisRun.update.mockResolvedValue(createRunRow({ status: 'deferred' }));

    await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    budgetState.expireAfterCalls = 1;
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'deferred',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
    });
    mocks.analysisResult.findMany.mockResolvedValue([
      { fixtureId: 'fx-1', enrichmentQuality: 'PRIMARY_COMPLETE' },
    ]);
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 2,
      picksGenerated: 2,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-b'], fixturesAnalyzed: 2, picksGenerated: 2 },
    }));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

    expect(result.status).toBe('completed');
    expect(result.fixturesAnalyzed).toBe(2);
    expect(result.picksGenerated).toBe(2);
    const resumeCp = (mocks.tx.analysisRun.update.mock.calls[2][0] as {
      data: { checkpoint: { processedFixtureIds: string[] } };
    }).data.checkpoint;
    expect(resumeCp.processedFixtureIds).toEqual(['fx-1', 'fx-b']);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('does not double-count picks when createMany skips a duplicate', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.enrichFixtures.mockResolvedValue([{ fixture: FIXTURE, enrichment: {} }]);
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 0 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 0,
      checkpoint: baseCheckpoint,
    }));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.picksGenerated).toBe(0);
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
    mocks.tx.analysisResult.createMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    mocks.tx.analysisRun.update
      .mockResolvedValueOnce(createRunRow({
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1'] },
      }))
      .mockResolvedValueOnce(createRunRow({
        status: 'completed',
        fixturesAnalyzed: 2,
        picksGenerated: 1,
        checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-b'], fixturesAnalyzed: 2, picksGenerated: 1 },
      }));

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('completed');
    expect(result.fixturesAnalyzed).toBe(2);
    expect(result.picksGenerated).toBe(1);
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
    expect(updateArg.data.checkpoint?.fixturesAnalyzed).toBe(updateArg.data.fixturesAnalyzed);
    expect(updateArg.data.checkpoint?.picksGenerated).toBe(updateArg.data.picksGenerated);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });
});

// ============================================================
// Prisma transaction boundaries with conditional updates (M2)
// ============================================================
describe('runDailyAnalysis M2 transaction boundaries', () => {
  beforeEach(() => {
    setupDefaultMocks();
    // Override transaction mock to properly simulate Prisma behavior
    mocks.transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
      try {
        return await cb(mocks.tx);
      } catch (error) {
        // Simulate Prisma: rollback happens, then error is re-thrown
        throw error;
      }
    });
  });

  // --- Exhausted-attempt path tests ---

  it('exhausted-attempt transition succeeds with checkpoint in transaction', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS = '3';
    budgetState.expireAfterCalls = 100;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === 'provider:quota:api-football') return HEALTHY_QUOTA;
      if (key.startsWith('analysis:fixture:attempts:')) return '3';
      return null;
    });
    mocks.analysisConfig.findMany.mockResolvedValue([
      { key: 'confidence_threshold', value: '70' },
      { key: 'market_weights', value: '{}' },
      { key: 'data_source_priorities', value: '[]' },
    ]);

    const exhaustedCheckpoint = {
      processedFixtureIds: [],
      fixturesAnalyzed: 0,
      picksGenerated: 0,
      completedBatches: 0,
      updatedAt: new Date().toISOString(),
    };
    const failedRunRow = createRunRow({
      status: 'failed',
      fixturesAnalyzed: 0,
      picksGenerated: 0,
      checkpoint: exhaustedCheckpoint,
    });
    mocks.tx.analysisRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.analysisRun.findUnique.mockResolvedValue({ fixturesAnalyzed: 0, picksGenerated: 0 });
    mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('failed');
    expect(result.fixturesAnalyzed).toBe(0);
    expect(result.picksGenerated).toBe(0);
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const updateCall = mocks.tx.analysisRun.updateMany.mock.calls[0][0] as {
      where: { id: string; status: string };
      data: { status: string; errorMessage: string; checkpoint: unknown };
    };
    expect(updateCall.where).toMatchObject({ id: 'run-1', status: 'running' });
    expect(updateCall.data.status).toBe('failed');
    expect(updateCall.data.errorMessage).toContain('exhausted');
    expect(updateCall.data.checkpoint).toBeDefined();
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  });

  // Test A: concurrent terminal transition — another worker already moved the run out of `running`

  it('exhausted transition with count 0 returns current run state without notifying', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS = '3';
    budgetState.expireAfterCalls = 100;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === 'provider:quota:api-football') return HEALTHY_QUOTA;
      if (key.startsWith('analysis:fixture:attempts:')) return '3';
      return null;
    });
    mocks.analysisConfig.findMany.mockResolvedValue([
      { key: 'confidence_threshold', value: '70' },
      { key: 'market_weights', value: '{}' },
      { key: 'data_source_priorities', value: '[]' },
    ]);

    // Another worker already transitioned the run to `completed`.
    mocks.tx.analysisRun.updateMany.mockResolvedValue({ count: 0 });
    mocks.analysisRun.findUnique.mockResolvedValue({
      status: 'completed',
      fixturesAnalyzed: 5,
      picksGenerated: 2,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('completed');
    expect(result.fixturesAnalyzed).toBe(5);
    expect(result.picksGenerated).toBe(2);
    expect(mocks.analysisRun.findUnique).toHaveBeenCalledWith({
      where: { id: 'run-1' },
      select: { status: true, fixturesAnalyzed: true, picksGenerated: true },
    });
    // No failure notification because we did not cause the transition.
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  });

  // Test C: current run missing after count 0 — handle safely without inventing a status

  it('exhausted transition with missing current run throws without notifying', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS = '3';
    budgetState.expireAfterCalls = 100;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === 'provider:quota:api-football') return HEALTHY_QUOTA;
      if (key.startsWith('analysis:fixture:attempts:')) return '3';
      return null;
    });
    mocks.analysisConfig.findMany.mockResolvedValue([
      { key: 'confidence_threshold', value: '70' },
      { key: 'market_weights', value: '{}' },
      { key: 'data_source_priorities', value: '[]' },
    ]);

    mocks.tx.analysisRun.updateMany.mockResolvedValue({ count: 0 });
    mocks.analysisRun.findUnique.mockResolvedValue(null);

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow(/no longer exists/);
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  });

  it('exhausted transition throws when checkpoint update fails', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE], errors: [] });
    mocks.redis.get.mockImplementation(async (key: string) => {
      if (key === 'provider:quota:api-football') return HEALTHY_QUOTA;
      if (key.startsWith('analysis:fixture:attempts:')) return '3';
      return null;
    });
    mocks.analysisConfig.findMany.mockResolvedValue([
      { key: 'confidence_threshold', value: '70' },
      { key: 'market_weights', value: '{}' },
      { key: 'data_source_priorities', value: '[]' },
      { key: 'analysisMaxAttempts', value: '3' },
    ]);

    mocks.tx.analysisRun.updateMany.mockRejectedValue(new Error('injected checkpoint failure'));
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('injected checkpoint failure');

    expect(mocks.tx.analysisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'run-1', status: 'running' }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  });

  // --- Lock-loss path tests ---

  // --- Deferred transition tests ---

  it('deferred transition succeeds with checkpoint in transaction', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    let updateCallCount = 0;
    mocks.tx.analysisRun.update.mockImplementation(async (args: { where: { id: string; status?: string }; data: unknown }) => {
      updateCallCount += 1;
      if (updateCallCount === 1) {
        return createRunRow({
          status: 'running',
          fixturesAnalyzed: 1,
          picksGenerated: 1,
          checkpoint: baseCheckpoint,
        });
      }
      expect(args.where).toMatchObject({ id: 'run-1', status: 'running' });
      expect(args.data).toMatchObject({ status: 'deferred' });
      return createRunRow({
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      });
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('deferred');
    expect(result.blockedReason).toContain('execution budget');
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('deferred transition throws when checkpoint update fails', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    let updateCallCount = 0;
    mocks.tx.analysisRun.update.mockImplementation(async (args: { where: { id: string; status?: string }; data: unknown }) => {
      updateCallCount += 1;
      if (updateCallCount === 1) {
        return createRunRow({
          status: 'running',
          fixturesAnalyzed: 1,
          picksGenerated: 1,
          checkpoint: baseCheckpoint,
        });
      }
      throw new Error('injected checkpoint failure');
    });
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('injected checkpoint failure');

    expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'run-1', status: 'running' }),
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    delete process.env.PROVIDER_ANALYSIS_MAX_ATTEMPTS;
  });

  // --- Idempotency and concurrency tests ---

  it('retrying transitions does not double-count results', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    mocks.tx.analysisRun.update
      .mockResolvedValueOnce(createRunRow({
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      }))
      .mockResolvedValueOnce(createRunRow({
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      }));
    mocks.analysisRun.update.mockResolvedValue(createRunRow({ status: 'deferred' }));

    const result1 = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });
    expect(result1.status).toBe('deferred');
    expect(result1.fixturesAnalyzed).toBe(1);

    const deferredUpdateCall = mocks.tx.analysisRun.update.mock.calls[1][0] as {
      where: { id: string; status: string };
      data: { status: string; checkpoint: unknown };
    };
    expect(deferredUpdateCall.where).toMatchObject({ id: 'run-1', status: 'running' });
    expect(deferredUpdateCall.data.status).toBe('deferred');

    budgetState.expireAfterCalls = 10;
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({
      status: 'completed',
      fixturesAnalyzed: 2,
      picksGenerated: 2,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-2'], fixturesAnalyzed: 2, picksGenerated: 2 },
    }));
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'run-1',
      status: 'deferred',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
      checkpoint: baseCheckpoint,
    });
    mocks.analysisResult.findMany.mockResolvedValue([
      { fixtureId: 'fx-1', enrichmentQuality: 'PRIMARY_COMPLETE' },
    ]);

    const result2 = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });
    expect(result2.status).toBe('completed');
    expect(result2.fixturesAnalyzed).toBe(2);
    expect(result2.picksGenerated).toBe(2);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  // --- Failure-state safety (completed-run eligibility + error isolation) ---

  it('catch block cannot overwrite a completed run and does not mask the original error', async () => {
    mocks.scoreFixture.mockImplementation(() => {
      throw new Error('boom');
    });
    // The run is already terminal, so the conditional failure transition
    // matches nothing and must not notify or mask the original error.
    mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('boom');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('failure-recording database error does not mask the original analysis error', async () => {
    mocks.scoreFixture.mockImplementation(() => {
      throw new Error('boom');
    });
    mocks.analysisRun.updateMany.mockRejectedValue(new Error('db down'));

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('boom');
    expect(mocks.sendEmail).not.toHaveBeenCalled();
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('notification failure does not mask the original analysis error', async () => {
    mocks.scoreFixture.mockImplementation(() => {
      throw new Error('boom');
    });
    mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });
    mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);
    mocks.sendEmail.mockRejectedValue(new Error('smtp down'));

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('boom');
    // One failed recipient still results in a send attempt.
    expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  // --- Lock-loss transitions ---

  it('lock-lost worker cannot overwrite a run that already reached a terminal state', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        // Advance past the 30s renewal interval so the lock is lost mid-run.
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      let txUpdateCalls = 0;
      mocks.tx.analysisRun.update.mockImplementation(async () => {
        txUpdateCalls += 1;
        return createRunRow({ status: txUpdateCalls === 1 ? 'running' : 'completed' });
      });
      // First batch commits, then the renewal fails and the lock is lost.
      mocks.redis.eval.mockResolvedValueOnce(0);
      // The run is already completed: conditional failure transition matches nothing.
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 0 });
      mocks.analysisRun.findUnique.mockResolvedValue({ status: 'completed', fixturesAnalyzed: 1, picksGenerated: 1 });

      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      expect(result.status).toBe('completed');
      expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'run-1', status: 'running' }) }),
      );
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lock-lost worker transitions a still-running run to failed and notifies', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({ status: 'running' }));
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValue({ count: 1 });
      mocks.analysisRun.findUnique.mockResolvedValue({ fixturesAnalyzed: 1, picksGenerated: 1 });
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);
      mocks.sendEmail.mockResolvedValue(undefined);

      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      expect(result.status).toBe('failed');
      expect(result.errors).toContain('analysis lock lost mid-run');
      expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'run-1', status: 'running' }),
          data: expect.objectContaining({ status: 'failed' }),
        }),
      );
      expect(mocks.sendEmail).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lock-lost preserves partial progress and stops further batches', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async (batch: any[]) => {
        await vi.advanceTimersByTimeAsync(35_000);
        return batch.map((f: any) => ({ fixture: f, enrichment: {} }));
      });
      mocks.scoreFixture.mockImplementation((fixture: any) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      let updateCalls = 0;
      mocks.tx.analysisRun.update.mockImplementation(async (args: any) => {
        updateCalls += 1;
        return createRunRow({ status: 'running', fixturesAnalyzed: updateCalls, picksGenerated: updateCalls, checkpoint: baseCheckpoint });
      });
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 1 });
      mocks.analysisRun.findUnique.mockResolvedValueOnce({ fixturesAnalyzed: 1, picksGenerated: 1 });
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);
      mocks.sendEmail.mockResolvedValue(undefined);

      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      expect(result.status).toBe('failed');
      expect(mocks.enrichFixtures).toHaveBeenCalledTimes(1);
      const enrichedIds = mocks.enrichFixtures.mock.calls[0][0].map((x: any) => x.id);
      expect(enrichedIds).toEqual(['fx-1']);
      expect(mocks.scoreFixture).toHaveBeenCalledTimes(1);
      expect(mocks.scoreFixture).toHaveBeenCalledWith(expect.objectContaining({ id: 'fx-1' }), expect.anything(), expect.anything());
      expect(mocks.tx.analysisResult.createMany).toHaveBeenCalledTimes(1);
      const createManyArg = mocks.tx.analysisResult.createMany.mock.calls[0][0];
      expect(createManyArg.data).toEqual([expect.objectContaining({ runId: 'run-1', fixtureId: 'fx-1' })]);
      expect(mocks.tx.analysisRun.update).toHaveBeenCalled();
      const firstUpdateArg = mocks.tx.analysisRun.update.mock.calls[0][0];
      const firstCp = firstUpdateArg.data.checkpoint;
      expect(firstCp).toMatchObject({
        processedFixtureIds: ['fx-1'],
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        completedBatches: 1,
      });
      expect(firstUpdateArg.data.fixturesAnalyzed).toBe(1);
      expect(firstUpdateArg.data.picksGenerated).toBe(1);
      expect(mocks.analysisRun.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ id: 'run-1', status: 'running' }) }),
      );
      const lockLossArg = mocks.analysisRun.updateMany.mock.calls[0][0];
      expect(lockLossArg.data).not.toHaveProperty('checkpoint');
      expect(lockLossArg.data).not.toHaveProperty('fixturesAnalyzed');
      expect(result.fixturesAnalyzed).toBe(1);
    } finally {
      delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
      vi.useRealTimers();
    }
  });

  it('lock-lost missing run after count 0 throws and does not notify', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({ status: 'running' }));
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 0 });
      mocks.analysisRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.analysisRun.findUnique.mockResolvedValueOnce(null);
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);

      await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow(/no longer exists/);
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lock-lost missing run after count 1 throws and does not notify', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({ status: 'running' }));
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 1 });
      mocks.analysisRun.updateMany.mockResolvedValue({ count: 0 });
      mocks.analysisRun.findUnique.mockResolvedValueOnce(null);
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);

      await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow(/no longer exists/);
      expect(mocks.sendEmail).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('lock-lost returns persisted counters differing from in-memory', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({ status: 'running', fixturesAnalyzed: 1, picksGenerated: 1 }));
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 1 });
      mocks.analysisRun.findUnique.mockResolvedValueOnce({ fixturesAnalyzed: 9, picksGenerated: 7 });
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);
      mocks.sendEmail.mockResolvedValue(undefined);

      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });
      expect(result.status).toBe('failed');
      expect(result.fixturesAnalyzed).toBe(9);
      expect(result.picksGenerated).toBe(7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('lock-lost notification failure does not mask recorded failure', async () => {
    vi.useFakeTimers();
    try {
      process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
      budgetState.expireAfterCalls = 100;
      mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
      mocks.enrichFixtures.mockImplementation(async () => {
        await vi.advanceTimersByTimeAsync(35_000);
        return [{ fixture: FIXTURE, enrichment: {} }];
      });
      mocks.scoreFixture.mockImplementation((fixture) => validOutcome(fixture));
      mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
      mocks.tx.analysisRun.update.mockResolvedValue(createRunRow({ status: 'running' }));
      mocks.redis.eval.mockResolvedValueOnce(0);
      mocks.analysisRun.updateMany.mockResolvedValueOnce({ count: 1 });
      mocks.analysisRun.findUnique.mockResolvedValueOnce({ fixturesAnalyzed: 1, picksGenerated: 1 });
      mocks.user.findMany.mockResolvedValue([{ id: 'sup-1', email: 'sup@test.example', name: 'Sup' }]);
      mocks.sendEmail.mockRejectedValue(new Error('smtp down'));

      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });
      expect(result.status).toBe('failed');
      expect(result.fixturesAnalyzed).toBe(1);
      expect(result.picksGenerated).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

});
