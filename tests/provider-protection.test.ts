/**
 * Phase 1 — Provider Protection regression tests.
 *
 * Covers the distributed rate limiter, quota monitoring, failure
 * classification, distributed single-flight caching, endpoint cache policy and
 * the automated-ingestion gate. All tests are hermetic: no live provider calls,
 * no production Redis, no timers left running.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ProviderProtectionError,
  acquireApiFootballSlot,
  getRateLimitConfig,
  parseReserveResult,
} from '@/lib/api/rate-limiter';
import {
  QUOTA_KEY,
  assessQuota,
  buildQuotaSnapshot,
  evaluateQuotaGate,
  getProviderQuota,
  unknownQuotaSnapshot,
} from '@/lib/api/quota';
import { classifyProviderFailure, isFatalProviderCategory } from '@/lib/api/failure-classification';
import { incrProviderMetric, readProviderMetrics } from '@/lib/api/provider-metrics';
import { captureRateLimitHeaders, storeRateLimitHeaders, getStoredRateLimitHeaders } from '@/lib/api/rate-limit-headers';
import { getProviderConfig, providerConfigSource } from '@/lib/api/provider-config';
import { resolveCacheTtlSeconds } from '@/lib/analysis/ingestion/cache';
import { evaluateIngestionGate } from '@/lib/analysis/ingestion/gating';
import { runSingleFlight, releaseLockSafely, SingleFlightError, type RedisLikeClient } from '@/lib/analysis/ingestion/single-flight';
import { redis } from '@/lib/redis';
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  withBoundedRetry,
} from '@/lib/api/retry';

const noSleep = async () => {};

// ---------------------------------------------------------------------------
// Distributed rate limiter (Stage 2)
// ---------------------------------------------------------------------------

describe('global distributed rate limiter', () => {
  it('grants a slot immediately when capacity is available', async () => {
    const reserve = vi.fn(async () => ({ allowed: true, waitMs: 0 }));
    await acquireApiFootballSlot({ reserve, sleep: noSleep });
    expect(reserve).toHaveBeenCalledTimes(1);
  });

  it('waits and retries when the permitted rate is reached, then succeeds', async () => {
    let calls = 0;
    const reserve = async () => ({ allowed: calls++ >= 2, waitMs: 10 });
    const sleep = vi.fn(noSleep);
    await acquireApiFootballSlot({ reserve, sleep, maxWaitMs: 5_000, maxSleepMs: 100 });
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it('fails closed when a slot cannot be obtained within maxWaitMs', async () => {
    const reserve = async () => ({ allowed: false, waitMs: 50 });
    await expect(
      acquireApiFootballSlot({ reserve, sleep: noSleep, maxWaitMs: 120, maxSleepMs: 50 }),
    ).rejects.toBeInstanceOf(ProviderProtectionError);
  });

  it('reserves a limiter slot for every retry attempt (no retry bypass)', async () => {
    let attempts = 0;
    const reserve = vi.fn(async () => ({ allowed: true, waitMs: 0 }));
    await expect(
      withBoundedRetry('t', async () => {
        attempts += 1;
        await acquireApiFootballSlot({ reserve, sleep: noSleep, now: () => Date.now() });
        throw new ProviderError('boom', { provider: 'api-football', recoverable: true });
      }, { retries: 2, baseDelayMs: 0, sleep: noSleep }),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(3);
    expect(reserve).toHaveBeenCalledTimes(3);
  });

  it('parses the atomic reserve result and rejects unknown shapes', () => {
    expect(parseReserveResult([1, 0])).toEqual({ allowed: true, waitMs: 0 });
    expect(parseReserveResult([0, 250])).toEqual({ allowed: false, waitMs: 250 });
    expect(() => parseReserveResult('nope')).toThrow(ProviderProtectionError);
  });

  it('exposes conservative internal safety limits by default', () => {
    const cfg = getRateLimitConfig();
    expect(cfg.perSecond).toBe(4);
    expect(cfg.perMinute).toBe(240);
  });

  it('fails closed when the distributed limiter (Redis) is unavailable', async () => {
    vi.resetModules();
    vi.doMock('@/lib/redis', () => ({
      redis: { eval: vi.fn().mockRejectedValue(new Error('redis down')) },
    }));
    try {
      const mod = await import('@/lib/api/rate-limiter');
      await expect(mod.acquireApiFootballSlot()).rejects.toBeInstanceOf(mod.ProviderProtectionError);
    } finally {
      vi.doUnmock('@/lib/redis');
      vi.resetModules();
    }
  });
});

// ---------------------------------------------------------------------------
// Quota monitoring (Stage 3)
// ---------------------------------------------------------------------------

describe('provider quota monitoring', () => {
  beforeEach(async () => {
    await redis.del(QUOTA_KEY);
  });

  it('builds a verified snapshot from the /status fields', () => {
    const snap = buildQuotaSnapshot({ requestsCurrent: 100, requestsLimitDay: 7_500, headers: {} });
    expect(snap).toMatchObject({ dailyLimit: 7_500, consumed: 100, remaining: 7_400, status: 'OK', source: 'status-endpoint' });
  });

  it('represents unavailable quota as UNKNOWN, never zero', () => {
    const snap = buildQuotaSnapshot({ headers: {} });
    expect(snap.dailyLimit).toBeNull();
    expect(snap.consumed).toBeNull();
    expect(snap.remaining).toBeNull();
    expect(snap.status).toBe('UNKNOWN');
    const fallback = unknownQuotaSnapshot();
    expect(fallback.status).toBe('UNKNOWN');
    expect(fallback.dailyLimit).toBeNull();
  });

  it('can fall back to verified rate-limit headers when present', () => {
    const snap = buildQuotaSnapshot({
      headers: { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' },
    });
    expect(snap).toMatchObject({ dailyLimit: 7_500, remaining: 7_000, consumed: 500, source: 'headers' });
  });

  it('applies the 70 / 85 / 95 % thresholds', () => {
    expect(assessQuota({ ...unknownQuotaSnapshot(), dailyLimit: 7_500, consumed: 3_000 }).level).toBe('ok');
    expect(assessQuota({ ...unknownQuotaSnapshot(), dailyLimit: 7_500, consumed: 5_250 }).level).toBe('warning');
    expect(assessQuota({ ...unknownQuotaSnapshot(), dailyLimit: 7_500, consumed: 6_375 }).level).toBe('critical');
    expect(assessQuota({ ...unknownQuotaSnapshot(), dailyLimit: 7_500, consumed: 7_125 }).level).toBe('stop');
  });

  it('reports unknown when quota values are unavailable', () => {
    expect(assessQuota(unknownQuotaSnapshot()).level).toBe('unknown');
  });

  it('marks a stale snapshot and blocks the gate conservatively', async () => {
    const stale = {
      ...unknownQuotaSnapshot(),
      dailyLimit: 7_500,
      consumed: 100,
      status: 'OK' as const,
      lastCheckedAt: '2026-01-01T00:00:00.000Z',
    };
    await redis.set(QUOTA_KEY, stale);
    const now = new Date('2026-11-22T06:00:00.000Z');
    const read = await getProviderQuota(now);
    expect(read.status).toBe('STALE');
    const gate = await evaluateQuotaGate(now);
    expect(gate.allowed).toBe(false);
  });

  it('blocks the gate at the stop threshold and allows after a quota reset', async () => {
    const now = new Date('2026-11-22T06:00:00.000Z');
    await redis.set(QUOTA_KEY, {
      ...unknownQuotaSnapshot(),
      dailyLimit: 7_500,
      consumed: 7_400,
      remaining: 100,
      status: 'OK',
      source: 'status-endpoint',
      lastCheckedAt: now.toISOString(),
    });
    expect((await evaluateQuotaGate(now)).allowed).toBe(false);

    // Quota resets the next day.
    await redis.set(QUOTA_KEY, {
      ...unknownQuotaSnapshot(),
      dailyLimit: 7_500,
      consumed: 5,
      remaining: 7_495,
      status: 'OK',
      source: 'status-endpoint',
      lastCheckedAt: now.toISOString(),
    });
    expect((await evaluateQuotaGate(now)).allowed).toBe(true);
  });

  it('allows unknown quota only under the explicit "warn" policy', async () => {
    const now = new Date('2026-11-22T06:00:00.000Z');
    delete process.env.PROVIDER_QUOTA_UNKNOWN_POLICY;
    expect((await evaluateQuotaGate(now)).allowed).toBe(false);

    process.env.PROVIDER_QUOTA_UNKNOWN_POLICY = 'warn';
    try {
      expect((await evaluateQuotaGate(now)).allowed).toBe(true);
    } finally {
      delete process.env.PROVIDER_QUOTA_UNKNOWN_POLICY;
    }
  });
});

// ---------------------------------------------------------------------------
// Failure classification & retry policy (Stage 4)
// ---------------------------------------------------------------------------

describe('provider failure classification', () => {
  it('classifies auth/quota as fatal and non-recoverable', () => {
    const quota = classifyProviderFailure(new ProviderQuotaExhaustedError('api-football', 'quota gone'));
    expect(quota.category).toBe('quota');
    expect(isFatalProviderCategory(quota.category)).toBe(true);

    const key = classifyProviderFailure(new ProviderAuthError('api-football', 401, 'bad key'));
    expect(key.category).toBe('invalid_key');
    expect(isFatalProviderCategory(key.category)).toBe(true);

    const auth = classifyProviderFailure(new ProviderAuthError('api-football', 403, 'not subscribed'));
    expect(auth.category).toBe('auth');
    expect(auth.recoverable).toBe(false);
  });

  it('classifies rate limit, server, network and timeout as recoverable', () => {
    expect(classifyProviderFailure(new ProviderRateLimitError('api-football', 'slow', 5)).category).toBe('rate_limit');
    expect(classifyProviderFailure(new ProviderError('down', { provider: 'api-football', status: 503, recoverable: true })).category).toBe('server');
    expect(classifyProviderFailure(new TypeError('fetch failed')).category).toBe('network');
    const timeout = new Error('timed out');
    timeout.name = 'TimeoutError';
    expect(classifyProviderFailure(timeout).category).toBe('timeout');
  });
});

// ---------------------------------------------------------------------------
// Distributed single-flight cache (Stage 5)
// ---------------------------------------------------------------------------

function fakeRedis(): RedisLikeClient & { store: Map<string, { value: unknown; exp: number | null }> } {
  const store = new Map<string, { value: unknown; exp: number | null }>();
  return {
    store,
    get: async <T>(k: string): Promise<T | null> => {
      const entry = store.get(k);
      if (!entry) return null;
      if (entry.exp !== null && entry.exp <= Date.now()) { store.delete(k); return null; }
      return entry.value as T;
    },
    set: async (k: string, v: unknown, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && store.has(k)) return null;
      store.set(k, { value: v, exp: opts?.ex ? Date.now() + opts.ex * 1_000 : null });
      return 'OK';
    },
    eval: async (_script: string, keys: string[], args: Array<string | number>) => {
      const entry = store.get(keys[0]);
      if (entry && entry.value === args[0]) { store.delete(keys[0]); return 1; }
      return 0;
    },
  };
}

const baseOptions = {
  key: 'k',
  ttlSeconds: 60,
  lockTtlSeconds: 30,
  waitMs: 500,
  pollMs: 5,
  now: () => Date.now(),
  makeToken: () => 'tok',
};

describe('distributed single-flight cache', () => {
  it('returns a cached value without invoking the loader (cache hit)', async () => {
    const client = fakeRedis();
    await client.set('k', 'cached', { ex: 60 });
    const loader = vi.fn(async () => 'loaded');
    const value = await runSingleFlight({ client, loader, ...baseOptions });
    expect(value).toBe('cached');
    expect(loader).not.toHaveBeenCalled();
  });

  it('loads once on a miss and caches the result', async () => {
    const client = fakeRedis();
    let loads = 0;
    const loader = async () => { loads += 1; return 'value'; };
    const first = await runSingleFlight({ client, loader, ...baseOptions });
    const second = await runSingleFlight({ client, loader, ...baseOptions });
    expect(first).toBe('value');
    expect(second).toBe('value');
    expect(loads).toBe(1);
  });

  it('prevents duplicate loads across concurrent cache misses', async () => {
    const client = fakeRedis();
    let loads = 0;
    const contention = vi.fn();
    const loader = async () => { loads += 1; await new Promise((r) => setTimeout(r, 20)); return 'shared'; };

    const [a, b] = await Promise.all([
      runSingleFlight({ client, loader, ...baseOptions }),
      runSingleFlight({ client, loader, ...baseOptions, onContention: contention }),
    ]);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(loads).toBe(1);
  });

  it('releases a lock with compare-and-delete (only the owner can release)', async () => {
    const client = fakeRedis();
    await client.set('k:__lock', 'owner-2', { ex: 30 });
    await releaseLockSafely(client, 'k:__lock', 'owner-1');
    expect(client.store.has('k:__lock')).toBe(true); // stale owner cannot delete
    await releaseLockSafely(client, 'k:__lock', 'owner-2');
    expect(client.store.has('k:__lock')).toBe(false);
  });

  it('propagates a loader failure and leaves no permanent lock', async () => {
    const client = fakeRedis();
    const loader = vi.fn(async () => { throw new Error('loader failed'); });
    await expect(runSingleFlight({ client, loader, ...baseOptions })).rejects.toThrow('loader failed');
    expect(client.store.has('k:__lock')).toBe(false);
    expect(client.store.has('k')).toBe(false);
  });

  it('never fabricates data when the waiter times out', async () => {
    const client = fakeRedis();
    await client.set('k:__lock', 'someone-else', { ex: 30 });
    await expect(
      runSingleFlight({ client, loader: async () => 'x', ...baseOptions, waitMs: 20, pollMs: 5 }),
    ).rejects.toBeInstanceOf(SingleFlightError);
  });

  it('runs the loader directly when Redis locking is unavailable (default degrade mode; no bypass of the limiter)', async () => {
    const client = fakeRedis();
    client.set = async () => { throw new Error('redis down'); };
    const loader = vi.fn(async () => 'direct');
    const onLockUnavailable = vi.fn();
    const value = await runSingleFlight({ client, loader, ...baseOptions, onLockUnavailable });
    expect(value).toBe('direct');
    expect(loader).toHaveBeenCalledTimes(1);
    expect(onLockUnavailable).toHaveBeenCalledTimes(1);
  });

  it('fails closed on Redis lock outage when outagePolicy is fail-closed (no duplicate provider calls, no fabricated value)', async () => {
    const client = fakeRedis();
    client.set = async () => { throw new Error('redis down'); };
    const loader = vi.fn(async () => 'should-not-run');
    const onLockUnavailable = vi.fn();
    await expect(
      runSingleFlight({ client, loader, ...baseOptions, outagePolicy: 'fail-closed', onLockUnavailable }),
    ).rejects.toBeInstanceOf(SingleFlightError);
    expect(loader).not.toHaveBeenCalled();
    expect(onLockUnavailable).toHaveBeenCalledTimes(1);
  });

  it('invokes onFailure when the lock owner loader throws (and still releases the lock)', async () => {
    const client = fakeRedis();
    const onFailure = vi.fn();
    const loader = async () => { throw new Error('boom'); };
    await expect(runSingleFlight({ client, loader, ...baseOptions, onFailure })).rejects.toThrow('boom');
    expect(onFailure).toHaveBeenCalledTimes(1);
    expect(client.store.has('k:__lock')).toBe(false);
  });

  it('invokes onWaiterTimeout when the bounded wait is exceeded', async () => {
    const client = fakeRedis();
    await client.set('k:__lock', 'someone-else', { ex: 30 });
    const onWaiterTimeout = vi.fn();
    await expect(
      runSingleFlight({ client, loader: async () => 'x', ...baseOptions, waitMs: 20, pollMs: 5, onWaiterTimeout }),
    ).rejects.toBeInstanceOf(SingleFlightError);
    expect(onWaiterTimeout).toHaveBeenCalledTimes(1);
  });

  it('a waiter takes over after the owner lock expires and never fabricates a result', async () => {
    // Owner holds the lock, never writes a value, then the lock expires (the
    // key disappears). The waiter acquires the lock itself and performs the
    // REAL load — it is never handed a fabricated value.
    const client = fakeRedis();
    await client.set('k:__lock', 'dead-owner', { ex: 30 });
    let loads = 0;
    const loader = async () => { loads += 1; return 'recovered'; };
    setTimeout(() => { client.store.delete('k:__lock'); }, 10); // simulate TTL expiry
    const value = await runSingleFlight({ client, loader, ...baseOptions, waitMs: 400, pollMs: 5 });
    expect(value).toBe('recovered');
    expect(loads).toBe(1);
  });

  it('does not cache non-cacheable (null) results', async () => {
    const client = fakeRedis();
    await runSingleFlight({ client, loader: async () => null, ...baseOptions });
    expect(client.store.has('k')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Cache policy (Stage 6)
// ---------------------------------------------------------------------------

describe('endpoint cache TTL policy', () => {
  const cfg = getProviderConfig({} as NodeJS.ProcessEnv);

  it('uses short TTLs for fast-moving data and long TTLs for slow-moving data', () => {
    expect(resolveCacheTtlSeconds('api-football:odds:1', cfg)).toBe(cfg.cacheTtlOddsSeconds);
    expect(resolveCacheTtlSeconds('api-football:fixtures:PL:a:b', cfg)).toBe(cfg.cacheTtlFixturesSeconds);
    expect(resolveCacheTtlSeconds('api-football:injuries:1', cfg)).toBe(cfg.cacheTtlInjuriesSeconds);
    expect(resolveCacheTtlSeconds('api-football:team-stats:1:39:2026', cfg)).toBe(cfg.cacheTtlTeamStatsSeconds);
    expect(resolveCacheTtlSeconds('api-football:h2h:1:2', cfg)).toBe(cfg.cacheTtlH2hSeconds);
    expect(resolveCacheTtlSeconds('api-football:scorers:39:2026', cfg)).toBe(cfg.cacheTtlScorersSeconds);
    expect(resolveCacheTtlSeconds('weather:51.5:-0.1', cfg)).toBe(cfg.cacheTtlWeatherSeconds);
    expect(resolveCacheTtlSeconds('something:else', cfg)).toBe(cfg.cacheTtlDefaultSeconds);
    // Odds must be the freshest of all.
    expect(cfg.cacheTtlOddsSeconds).toBeLessThan(cfg.cacheTtlInjuriesSeconds);
  });
});

// ---------------------------------------------------------------------------
// Rate-limit header capture (Stage 3/8)
// ---------------------------------------------------------------------------

describe('rate-limit response header capture', () => {
  it('captures only the documented numeric headers', () => {
    const response = {
      headers: {
        get: (name: string) => ({
          'x-ratelimit-requests-limit': '7500',
          'x-ratelimit-requests-remaining': '7400',
        }[name.toLowerCase()] ?? null),
      },
    } as unknown as Response;
    expect(captureRateLimitHeaders(response)).toEqual({
      'x-ratelimit-requests-limit': '7500',
      'x-ratelimit-requests-remaining': '7400',
    });
  });

  it('stores and reads back captured headers', async () => {
    await storeRateLimitHeaders({ 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' });
    const stored = await getStoredRateLimitHeaders();
    expect(stored?.limit).toBe(7_500);
    expect(stored?.remaining).toBe(7_000);
  });

  it('does not overwrite with empty values', async () => {
    await storeRateLimitHeaders({ 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' });
    await storeRateLimitHeaders({});
    const stored = await getStoredRateLimitHeaders();
    expect(stored?.limit).toBe(7_500);
  });
});

// ---------------------------------------------------------------------------
// Provider metrics (Stage 6/8)
// ---------------------------------------------------------------------------

describe('provider metrics', () => {
  it('increments and reads day-scoped counters', async () => {
    // Dedicated day: earlier tests in this file increment `provider:requests`
    // via the shared in-memory store, so use an isolated day key.
    const now = new Date('2031-05-05T06:00:00.000Z');
    await incrProviderMetric('cache:hit', now);
    await incrProviderMetric('cache:hit', now);
    await incrProviderMetric('provider:requests', now);
    const metrics = await readProviderMetrics(now);
    expect(metrics.day).toBe('2031-05-05');
    expect(metrics.cacheHits).toBe(2);
    expect(metrics.providerRequests).toBe(1);
    expect(metrics.cacheMisses).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Ingestion gate (Stage 9)
// ---------------------------------------------------------------------------

describe('automated-ingestion gate', () => {
  const readyDeps = {
    probeRedis: async () => {},
    checkQuota: async () => ({ allowed: true, level: 'ok' as const, reason: 'ok', quota: unknownQuotaSnapshot() }),
    checkCooldown: async () => false,
  };

  it('is ready when Redis, quota and the provider circuit are healthy', async () => {
    const gate = await evaluateIngestionGate(readyDeps);
    expect(gate.ok).toBe(true);
    expect(gate.status).toBe('ready');
    expect(gate.reasons).toEqual([]);
  });

  it('fails closed when Redis is unavailable', async () => {
    const gate = await evaluateIngestionGate({ ...readyDeps, probeRedis: async () => { throw new Error('down'); } });
    expect(gate.ok).toBe(false);
    expect(gate.redisAvailable).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/redis unavailable/i);
  });

  it('blocks when the daily quota has reached the stop threshold', async () => {
    const gate = await evaluateIngestionGate({
      ...readyDeps,
      checkQuota: async () => ({ allowed: false, level: 'stop' as const, reason: '95% consumed', quota: unknownQuotaSnapshot() }),
    });
    expect(gate.ok).toBe(false);
    expect(gate.reasons.join(' ')).toMatch(/95% consumed/);
  });

  it('blocks during a provider cooldown', async () => {
    const gate = await evaluateIngestionGate({ ...readyDeps, checkCooldown: async () => true });
    expect(gate.ok).toBe(false);
    expect(gate.providerCooldown).toBe(true);
    expect(gate.reasons.join(' ')).toMatch(/cooldown/i);
  });
});

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

describe('provider-protection configuration', () => {
  const prev = { ...process.env };
  afterEach(() => { process.env = { ...prev }; });

  it('uses conservative defaults and per-field fallback for malformed input', () => {
    const defaults = getProviderConfig({} as NodeJS.ProcessEnv);
    expect(defaults.apiFootballRps).toBe(4);
    expect(defaults.apiFootballRpm).toBe(240);
    expect(defaults.quotaUnknownPolicy).toBe('block');

    process.env.PROVIDER_RPS = 'not-a-number';
    process.env.PROVIDER_RPM = '120';
    const parsed = getProviderConfig();
    expect(parsed.apiFootballRps).toBe(4); // malformed → default
    expect(parsed.apiFootballRpm).toBe(120); // valid sibling preserved
  });

  it('maps documented env names to config fields', () => {
    const source = providerConfigSource({ PROVIDER_RPS: '7' } as unknown as NodeJS.ProcessEnv);
    expect(source.apiFootballRps).toBe('7');
  });
});
