/**
 * M3 — quota accounting per actual HTTP attempt.
 *
 * Every outbound provider request must reserve (rate-limit + daily quota) on
 * EACH attempt, including retries, and an attempt rejected BEFORE reaching the
 * provider must not consume quota or hit the network. These tests are hermetic:
 * Redis, the rate limiter, the circuit breaker, metrics and the cache are
 * mocked; only the real retry + quota accounting code runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  incr: vi.fn(),
  eval: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  expire: vi.fn(),
  acquireSlot: vi.fn(),
  assertAvailable: vi.fn(),
  recordSuccess: vi.fn(),
  recordFailure: vi.fn(),
  incrMetric: vi.fn(),
  cachedProviderFetch: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
  fetch: vi.fn(),
}));

vi.mock('@/lib/redis', () => ({
  redis: { incr: h.incr, eval: h.eval, get: h.get, set: h.set, del: h.del, expire: h.expire },
}));

vi.mock('@/lib/api/rate-limiter', () => ({
  acquireApiFootballSlot: h.acquireSlot,
  acquireFootballDataSlot: h.acquireSlot,
  ProviderProtectionError: class ProviderProtectionError extends Error {},
}));

vi.mock('@/lib/api/circuit-breaker', () => ({
  assertProviderAvailable: h.assertAvailable,
  recordProviderSuccess: h.recordSuccess,
  recordProviderFailure: h.recordFailure,
}));

vi.mock('@/lib/api/provider-metrics', () => ({ incrProviderMetric: h.incrMetric }));
vi.mock('@/lib/analysis/ingestion/cache', () => ({ cachedProviderFetch: h.cachedProviderFetch }));

import { fetchApiFootballFixtures } from '@/lib/api/football-api';
import { reserveProviderQuota } from '@/lib/api/quota';
import { ProviderQuotaExhaustedError } from '@/lib/api/retry';

const PREV_ENV = { ...process.env };
let counter = 0;

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => payload } as unknown as Response;
}

function apiFootballFixtureResponse() {
  return jsonResponse({
    response: [
      {
        fixture: { id: 101, date: '2026-11-22T15:00:00Z' },
        league: { name: 'Premier League' },
        teams: { home: { id: 1, name: 'Arsenal' }, away: { id: 2, name: 'Chelsea' } },
      },
    ],
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  counter = 0;
  // Atomic in-memory counter backing `reserveProviderQuota`.
  h.incr.mockImplementation(async () => {
    counter += 1;
    return counter;
  });
  h.eval.mockResolvedValue([1, 0]); // limiter: granted
  h.get.mockResolvedValue(null);
  h.set.mockResolvedValue('OK');
  h.del.mockResolvedValue(1);
  h.expire.mockResolvedValue(1);
  h.acquireSlot.mockResolvedValue(undefined);
  h.assertAvailable.mockResolvedValue(undefined);
  h.cachedProviderFetch.mockImplementation(async (_k, loader) => loader());
  vi.stubGlobal('fetch', h.fetch);

  process.env.API_FOOTBALL_KEY = 'test-key';
  process.env.FOOTBALL_API_DAILY_LIMIT = '100';
  process.env.PROVIDER_RETRY_BASE_MS = '0'; // no real backoff delay in tests
});

afterEach(() => {
  process.env = { ...PREV_ENV };
  vi.unstubAllGlobals();
});

describe('M3: quota reserved per actual HTTP attempt', () => {
  it('one successful request consumes exactly one reservation', async () => {
    h.fetch.mockResolvedValueOnce(apiFootballFixtureResponse());

    const fixtures = await fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23');

    expect(fixtures).toHaveLength(1);
    expect(h.acquireSlot).toHaveBeenCalledTimes(1);
    expect(h.incr).toHaveBeenCalledTimes(1); // one quota reservation
    expect(h.fetch).toHaveBeenCalledTimes(1);
    expect(counter).toBe(1);
  });

  it('three actual attempts (two retries) consume three reservations', async () => {
    process.env.PROVIDER_MAX_RETRIES = '2'; // global test setup disables retries
    h.fetch
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(apiFootballFixtureResponse());

    const fixtures = await fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23');

    expect(fixtures).toHaveLength(1);
    expect(h.fetch).toHaveBeenCalledTimes(3); // three real outbound attempts
    expect(h.acquireSlot).toHaveBeenCalledTimes(3); // re-reserved each attempt
    expect(h.incr).toHaveBeenCalledTimes(3); // quota re-reserved each attempt
    expect(counter).toBe(3);
  });

  it('a request rejected before the provider does not consume quota or call fetch', async () => {
    // Rate limiter denies every attempt -> the request never reaches the network.
    h.acquireSlot.mockRejectedValue(new Error('rate limit wait exceeded'));

    await expect(
      fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23'),
    ).rejects.toThrow();

    expect(h.fetch).not.toHaveBeenCalled(); // never hit the provider
    expect(h.incr).not.toHaveBeenCalled(); // no quota consumed
    expect(counter).toBe(0);
  });

  it('quota exhaustion prevents additional requests', async () => {
    process.env.FOOTBALL_API_DAILY_LIMIT = '1';
    h.fetch.mockResolvedValue(apiFootballFixtureResponse());

    // First request: within quota (consumed = 1).
    const first = await fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23');
    expect(first).toHaveLength(1);

    // Second request: quota exhausted -> rejected before fetch.
    await expect(
      fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23'),
    ).rejects.toBeInstanceOf(ProviderQuotaExhaustedError);

    expect(h.fetch).toHaveBeenCalledTimes(1); // second attempt never hit the provider
  });

  it('concurrent reservations cannot exceed the configured daily limit', async () => {
    process.env.FOOTBALL_API_DAILY_LIMIT = '5';

    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => reserveProviderQuota('api-football')),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(5); // exactly the daily limit
    expect(rejected).toHaveLength(7);
    expect(rejected.every((r) => (r as PromiseRejectedResult).reason instanceof ProviderQuotaExhaustedError)).toBe(true);
    expect(counter).toBe(12); // every attempt was counted atomically
  });

  it('fails closed when the quota store (Redis) is unavailable', async () => {
    h.incr.mockRejectedValueOnce(new Error('redis down'));
    await expect(reserveProviderQuota('api-football')).rejects.toBeInstanceOf(
      ProviderQuotaExhaustedError,
    );
  });
});