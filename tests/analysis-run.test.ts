import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  analysisRun: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  analysisResult: { createMany: vi.fn() },
  analysisConfig: { findMany: vi.fn() },
  transaction: vi.fn(),
  redis: { set: vi.fn(), del: vi.fn() },
  tx: {
    analysisResult: { createMany: vi.fn() },
    analysisRun: { update: vi.fn() },
  },
  fetchFixtures: vi.fn(),
  enrichFixtures: vi.fn(),
  getEnabledLeagues: vi.fn(),
  scoreFixture: vi.fn(),
}));

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

function validOutcome(fixture: Fixture = FIXTURE): AnalysisOutcome {
  const best = {
    market: 'MATCH_RESULT' as MarketType,
    selection: `${fixture.homeTeam}`,
    odds: 1.91,
    oddsAvailable: true,
    confidence: 82,
    modelProbability: 0.55,
    factors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
  };
  return {
    fixture,
    scores: [best],
    best,
    topFactors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
    eligibility: [],
  };
}

describe('runDailyAnalysis persistence', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.redis.set.mockResolvedValue('OK');
    mocks.redis.del.mockResolvedValue(1);
    mocks.analysisConfig.findMany.mockResolvedValue([]);
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
});
