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

const FIXTURE: Fixture = {
  id: 'fx-1',
  leagueCode: 'PL',
  leagueName: 'English Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

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
    expect(result).toMatchObject({ status: 'completed', picksGenerated: 1 });
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
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('creates a fresh run when forced', async () => {
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'existing-run',
      status: 'completed',
      fixturesAnalyzed: 5,
      picksGenerated: 2,
    });
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
    mocks.tx.analysisRun.update.mockResolvedValue({
      id: 'run-2',
      status: 'completed',
      fixturesAnalyzed: 1,
      picksGenerated: 1,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(mocks.analysisRun.findFirst).not.toHaveBeenCalled();
    expect(mocks.analysisRun.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ runId: 'run-2', status: 'completed' });
  });

  it('rejects a malformed outcome before writing any rows', async () => {
    mocks.analysisRun.create.mockResolvedValue({ id: 'run-3', status: 'running' });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-3', status: 'failed' });
    mocks.scoreFixture.mockImplementation((fixture: Fixture) => {
      const outcome = validOutcome(fixture);
      return { ...outcome, best: { ...outcome.best, confidence: Number.NaN } };
    });

    await expect(runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true })).rejects.toThrow(
      /Invalid confidence/,
    );
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.analysisRun.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  // --- Stage 9: provider-protection ingestion gating ---

  it('blocks the run (no rows, not successful) when Redis is unavailable', async () => {
    mocks.redis.get.mockRejectedValue(new Error('redis down'));

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

  // --- §6: execution-time budget, resumable idempotent batches ---

  const FIXTURE2: Fixture = { ...FIXTURE, id: 'fx-2' };

  function twoFixtureWorkload(): void {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE2], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });
  }

  it('defers the remainder when the execution budget is spent (no partial-run success)', async () => {
    twoFixtureWorkload();
    mocks.tx.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'running', fixturesAnalyzed: 1, picksGenerated: 1 });
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-1', status: 'deferred' });

    try {
      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

      expect(result.status).toBe('deferred');
      expect(result.blockedReason).toMatch(/deferred/i);
      // Only the first batch committed; the run is NOT marked completed.
      expect(mocks.transaction).toHaveBeenCalledTimes(1);
      expect(mocks.analysisRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-1' }, data: { status: 'deferred' } }),
      );
    } finally {
      delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    }
  });

  it('resumes a deferred run and skips already-persisted fixtures (no duplicate predictions)', async () => {
    twoFixtureWorkload();
    mocks.analysisRun.findFirst.mockResolvedValue({ id: 'run-def', status: 'deferred', fixturesAnalyzed: 1, picksGenerated: 1 });
    mocks.analysisResult.findMany.mockResolvedValue([{ fixtureId: 'fx-1' }]);
    mocks.analysisRun.update.mockResolvedValue({ id: 'run-def', status: 'running' });
    mocks.tx.analysisRun.update.mockResolvedValue({ id: 'run-def', status: 'completed', fixturesAnalyzed: 2, picksGenerated: 2 });

    try {
      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

      // Resumed the SAME run (flipped back to running) rather than creating a new one.
      expect(mocks.analysisRun.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'run-def' }, data: { status: 'running' } }),
      );
      expect(mocks.analysisRun.create).not.toHaveBeenCalled();
      // Only the not-yet-persisted fixture was enriched/scored.
      expect(mocks.enrichFixtures).toHaveBeenCalledTimes(1);
      expect(mocks.enrichFixtures).toHaveBeenCalledWith([FIXTURE2], expect.anything());
      expect(result).toMatchObject({ runId: 'run-def', status: 'completed' });
    } finally {
      delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
    }
  });

  // --- M1: cumulative count excludes insufficient-data / failed outcomes ---

  const FIXTURE3: Fixture = { ...FIXTURE, id: 'fx-3' };
  const FIXTURE4: Fixture = { ...FIXTURE, id: 'fx-4' };

  it('resumes a deferred run and counts only successfully-analysed prior fixtures', async () => {
    process.env.PROVIDER_ANALYSIS_BATCH_SIZE = '1';
    budgetState.expireAfterCalls = 1; // one batch, then defer
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'run-def', status: 'deferred', fixturesAnalyzed: 0, picksGenerated: 0,
    });
    // fx-1 previously succeeded; fx-2 previously had INSUFFICIENT_DATA (must NOT count).
    mocks.analysisResult.findMany.mockResolvedValue([
      { fixtureId: 'fx-1', enrichmentQuality: 'PRIMARY_COMPLETE' },
      { fixtureId: 'fx-2', enrichmentQuality: 'INSUFFICIENT_DATA' },
    ]);
    let updateCallCount = 0;
    mocks.analysisRun.update.mockImplementation(async (args: { where: { id: string }; data: { status: string } }) => {
      updateCallCount += 1;
      if (updateCallCount === 1) {
        // First call: resume run (status: 'running')
        return { id: 'run-def', status: 'running', fixturesAnalyzed: 1, picksGenerated: 1 };
      }
      // Second call: deferred status change
      return { id: 'run-def', status: 'deferred', fixturesAnalyzed: 2, picksGenerated: 1 };
    });
    mocks.tx.analysisRun.update.mockResolvedValue({ id: 'run-def', status: 'deferred', fixturesAnalyzed: 2, picksGenerated: 1 });
    mocks.fetchFixtures.mockResolvedValue({ fixtures: [FIXTURE, FIXTURE2, FIXTURE3, FIXTURE4], errors: [] });
    mocks.enrichFixtures.mockImplementation(async (batch: Fixture[]) =>
      batch.map((fixture) => ({ fixture, enrichment: {} })),
    );
    mocks.scoreFixture.mockImplementation((fixture: Fixture) => validOutcome(fixture));
    mocks.tx.analysisResult.createMany.mockResolvedValue({ count: 1 });

    try {
      const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z') });

      expect(result.status).toBe('deferred');
      // fx-1 (prior success) + fx-3 (this run's success) counted; fx-2 (INSUFFICIENT_DATA) excluded; fx-4 not yet processed.
      expect(result.fixturesAnalyzed).toBe(2);
      expect(result.blockedReason).toMatch(/deferred/i);
    } finally {
      delete process.env.PROVIDER_ANALYSIS_BATCH_SIZE;
      budgetState.expireAfterCalls = 1;
    }
  });

  // --- H2: two workers competing for the same run ---

  it('does not create a second run when the day-lock is held by another worker', async () => {
    mocks.redis.set.mockResolvedValue(null); // lock held elsewhere
    mocks.analysisRun.findFirst.mockResolvedValue({
      id: 'held-run', status: 'running', fixturesAnalyzed: 3, picksGenerated: 1,
    });

    const result = await runDailyAnalysis({ now: new Date('2026-11-22T06:00:00.000Z'), force: true });

    expect(result).toMatchObject({ runId: 'held-run', status: 'running', alreadyRunning: true });
    expect(mocks.analysisRun.create).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
});
