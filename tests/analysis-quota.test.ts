import { afterEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({ redis: mocks }));

import {
  QuotaExceededError,
  getQuotaStatus,
  reserveQuota,
} from '@/lib/analysis/quota';

afterEach(() => {
  vi.clearAllMocks();
  delete process.env.FOOTBALL_API_DAILY_LIMIT;
});

describe('reserveQuota', () => {
  it('allows a request and reports usage when under the cap (api-football)', async () => {
    mocks.eval.mockResolvedValue([1, 5]);
    const status = await reserveQuota('api-football');
    expect(status).toEqual({ allowed: true, used: 5, limit: 100 });
    expect(mocks.eval).toHaveBeenCalledTimes(1);
  });

  it('denies a request when the quota is exhausted', async () => {
    mocks.eval.mockResolvedValue([0, 100]);
    const status = await reserveQuota('api-football');
    expect(status.allowed).toBe(false);
    expect(status.used).toBe(100);
    expect(status.limit).toBe(100);
  });

  it('honours a FOOTBALL_API_DAILY_LIMIT override', async () => {
    process.env.FOOTBALL_API_DAILY_LIMIT = '50';
    mocks.eval.mockResolvedValue([1, 10]);
    const status = await reserveQuota('api-football');
    expect(status.limit).toBe(50);
    // The limit is passed to the Lua script as an argument.
    const args = mocks.eval.mock.calls[0][2] as string[];
    expect(args).toContain('50');
  });

  it('does not gate providers without a configured hard cap (football-data)', async () => {
    const status = await reserveQuota('football-data');
    expect(status).toEqual({ allowed: true, used: 0, limit: Infinity });
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('fails open when the quota store errors', async () => {
    mocks.eval.mockRejectedValue(new Error('redis down'));
    const status = await reserveQuota('api-football');
    expect(status.allowed).toBe(true);
  });
});

describe('getQuotaStatus', () => {
  it('reads current usage without consuming quota', async () => {
    mocks.get.mockResolvedValue(42);
    const status = await getQuotaStatus('api-football');
    expect(status).toEqual({ allowed: true, used: 42, limit: 100 });
    expect(mocks.eval).not.toHaveBeenCalled();
  });

  it('reports not-allowed once usage reaches the limit', async () => {
    mocks.get.mockResolvedValue(100);
    const status = await getQuotaStatus('api-football');
    expect(status.allowed).toBe(false);
  });

  it('returns an unbounded status for unlisted providers', async () => {
    const status = await getQuotaStatus('football-data');
    expect(status).toEqual({ allowed: true, used: 0, limit: Infinity });
    expect(mocks.get).not.toHaveBeenCalled();
  });
});

describe('QuotaExceededError', () => {
  it('carries provider and usage details', () => {
    const err = new QuotaExceededError('api-football', 100, 100);
    expect(err.name).toBe('QuotaExceededError');
    expect(err.providerLabel).toBe('api-football');
    expect(err.used).toBe(100);
    expect(err.limit).toBe(100);
  });
});