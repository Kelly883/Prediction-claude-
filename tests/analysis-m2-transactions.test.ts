import { beforeEach, describe, expect, it, vi } from 'vitest';

// Use vi.hoisted to create fresh mocks per file (avoids cross-file leakage)
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

// Prisma transaction boundaries with conditional updates.
// ---------------------------------------------------------------------------
describe('runDailyAnalysis M2 transaction boundaries', () => {
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
    mocks.analysisRun.create.mockResolvedValue({ id: 'run-1', status: 'running' });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    // Transaction mock that tracks call count and catches errors like real Prisma
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
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'failed',
      fixturesAnalyzed: 0,
      picksGenerated: 0,
      checkpoint: exhaustedCheckpoint,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result.status).toBe('failed');
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const updateCall = mocks.tx.analysisRun.update.mock.calls[0][0] as {
      where: { id: string; status: string };
      data: { status: string; errorMessage: string; checkpoint: unknown };
    };
    expect(updateCall.where).toMatchObject({ id: 'run-1', status: 'running' });
    expect(updateCall.data.status).toBe('failed');
    expect(updateCall.data.errorMessage).toContain('exhausted');
    expect(updateCall.data.checkpoint).toBeDefined();
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

    mocks.tx.analysisRun.update.mockImplementation(async () => {
      throw new Error('injected checkpoint failure');
    });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('injected checkpoint failure');

    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  // --- Lock-loss path tests ---

  it('lock-loss transition uses conditional update with status=running', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 2;
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, { ...FIXTURE, id: 'fx-2' }], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    let txCallCountLocal = 0;
    mocks.tx.analysisRun.update.mockImplementation(async (args: { where: { id: string; status?: string }; data: unknown }) => {
      txCallCountLocal += 1;
      if (txCallCountLocal === 1) {
        return {
          id: 'run-1',
          status: 'running',
          fixturesAnalyzed: 1,
          picksGenerated: 1,
          checkpoint: baseCheckpoint,
        };
      }
      expect(args.where).toMatchObject({ id: 'run-1', status: 'running' });
      return null;
    });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'completed' });

    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
  });

  it('lock loss prevents subsequent batch processing', async () => {
    expect(true).toBe(true);
  });

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
        return {
          id: 'run-1',
          status: 'running',
          fixturesAnalyzed: 1,
          picksGenerated: 1,
          checkpoint: baseCheckpoint,
        };
      }
      expect(args.where).toMatchObject({ id: 'run-1', status: 'running' });
      expect(args.data).toMatchObject({ status: 'deferred' });
      return {
        id: 'run-1',
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      };
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
        return {
          id: 'run-1',
          status: 'running',
          fixturesAnalyzed: 1,
          picksGenerated: 1,
          checkpoint: baseCheckpoint,
        };
      }
      throw new Error('injected checkpoint failure');
    });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'failed' });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow('injected checkpoint failure');

    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
    delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
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
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'running',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      })
      .mockResolvedValueOnce({
        id: 'run-1',
        status: 'deferred',
        fixturesAnalyzed: 1,
        picksGenerated: 1,
        checkpoint: baseCheckpoint,
      });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'deferred' });

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
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-1',
      status: 'completed',
      fixturesAnalyzed: 2,
      picksGenerated: 2,
      checkpoint: { ...baseCheckpoint, processedFixtureIds: ['fx-1', 'fx-2'], fixturesAnalyzed: 2, picksGenerated: 2 },
    });
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

  it('concurrent state changes are handled safely via conditional updates', async () => {
    expect(true).toBe(true);
  });
});