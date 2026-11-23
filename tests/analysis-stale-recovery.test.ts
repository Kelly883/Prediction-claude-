import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateMany: vi.fn(),
  findMany: vi.fn(),
  redisGet: vi.fn(),
  incrProviderMetric: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: {
    analysisRun: { findMany: mocks.findMany, updateMany: mocks.updateMany },
  },
}));
vi.mock('@/lib/redis', () => ({ redis: { get: mocks.redisGet } }));
vi.mock('@/lib/api/provider-metrics', () => ({
  incrProviderMetric: mocks.incrProviderMetric,
}));

import { recoverStaleRuns } from '@/lib/analysis/run';

const STALE_RUN = { id: 'stale-1', runDate: new Date('2026-11-20T00:00:00Z'), updatedAt: new Date('2026-11-20T04:00:00Z') };

beforeEach(() => {
  vi.resetAllMocks();
  mocks.findMany.mockResolvedValue([STALE_RUN]);
  mocks.redisGet.mockResolvedValue(null);
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('H1: recoverStaleRuns atomicity', () => {
  it('recovers a stale running run and records audit once', async () => {
    const count = await recoverStaleRuns();

    expect(mocks.findMany).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'stale-1', status: 'running' },
      data: { status: 'failed', errorMessage: 'stale run recovered', completedAt: expect.any(Date) },
    });
    expect(count).toBe(1);
    expect(mocks.incrProviderMetric).toHaveBeenCalledWith('ingestion:staleRecovered');
  });

  it('never overwrites a run that completed between discovery and recovery (race)', async () => {
    // Discovery saw it as running, but by the time we update it is completed.
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await recoverStaleRuns();

    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'stale-1', status: 'running' },
      data: expect.objectContaining({ status: 'failed' }),
    });
    // The conditional update matched 0 rows → nothing recovered, no audit.
    expect(count).toBe(0);
    expect(mocks.incrProviderMetric).not.toHaveBeenCalled();
  });

  it('never overwrites a run already marked failed', async () => {
    mocks.updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await recoverStaleRuns();

    expect(count).toBe(0);
    expect(mocks.incrProviderMetric).not.toHaveBeenCalled();
  });

  it('does not recover a run whose Redis day-lock is still held', async () => {
    mocks.redisGet.mockResolvedValueOnce('owner-token');

    const count = await recoverStaleRuns();

    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(count).toBe(0);
    expect(mocks.incrProviderMetric).not.toHaveBeenCalled();
  });

  it('concurrent recovery attempts record only one successful recovery', async () => {
    // First caller wins (count 1), second loses because status is no longer 'running' (count 0).
    mocks.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    const [a, b] = await Promise.all([recoverStaleRuns(), recoverStaleRuns()]);

    expect(a + b).toBe(1);
    expect(mocks.incrProviderMetric).toHaveBeenCalledTimes(1);
  });
});
