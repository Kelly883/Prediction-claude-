/**
 * Phase 1 — Provider Protection HARDENING regression tests (§11).
 *
 * Exercises the NEW/hardened behaviour introduced by the Provider Protection
 * Hardening task:
 *   - the sliding-window distributed rate limiter (§3) and its fail-closed paths,
 *   - the independent Football-Data.org limiter (§2),
 *   - the corrected daily vs per-minute quota semantics (§4),
 *   - the corrected Retry-After handling (§5),
 *   - the execution-time budget estimator (§6),
 *   - single-flight Redis-outage behaviour (§7),
 *   - provider-scoped metrics (§9) and the monitoring/CRON security surface (§8/§10).
 *
 * Everything is hermetic: the in-memory Redis store is used (tests/setup.ts
 * clears UPSTASH_* so no live client is built), the provider `/status` call is
 * mocked, and no timers are left running. Results here are MOCK-VERIFIED /
 * CALCULATED — they do NOT prove live provider behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  fetchApiFootballStatus: vi.fn(),
  requireAnalysisAdmin: vi.fn(),
  runDailyAnalysis: vi.fn(),
  writeAudit: vi.fn(),
  analysisRunFindFirst: vi.fn(),
}));

// Provider `/status` is mocked so quota refresh tests never make a live call.
vi.mock('@/lib/api/football-api', () => ({ fetchApiFootballStatus: hoisted.fetchApiFootballStatus }));
// Superadmin auth for the monitoring endpoint.
vi.mock('@/lib/analysis/api-auth', () => ({ requireAnalysisAdmin: hoisted.requireAnalysisAdmin }));
// The daily-analysis cron route is tested for its auth envelope only.
vi.mock('@/lib/analysis/run', () => ({ runDailyAnalysis: hoisted.runDailyAnalysis }));
vi.mock('@/lib/audit', () => ({ writeAudit: hoisted.writeAudit }));
vi.mock('@/lib/prisma', () => ({ prisma: { analysisRun: { findFirst: hoisted.analysisRunFindFirst } } }));

import {
  ProviderProtectionError,
  SLIDING_WINDOW_LUA,
  acquireApiFootballSlot,
  acquireFootballDataSlot,
  getApiFootballLimiterConfig,
  getFootballDataLimiterConfig,
  getFootballDataRateLimitConfig,
  getRateLimitConfig,
  parseReserveResult,
} from '@/lib/api/rate-limiter';
import {
  QUOTA_KEY,
  assessQuota,
  buildQuotaSnapshot,
  headerQuotaSnapshot,
  refreshProviderQuota,
  unknownQuotaSnapshot,
} from '@/lib/api/quota';
import { getProviderConfig } from '@/lib/api/provider-config';
import { incrProviderMetric, readProviderMetrics } from '@/lib/api/provider-metrics';
import {
  captureRateLimitHeaders,
  getStoredRateLimitHeaders,
  storeRateLimitHeaders,
} from '@/lib/api/rate-limit-headers';
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  parseRetryAfter,
  providerErrorFromResponse,
  withBoundedRetry,
} from '@/lib/api/retry';
import {
  ENRICHMENT_REQUESTS_PER_FIXTURE,
  createRunBudget,
  estimateRuntimeMs,
  runtimeInputs,
} from '@/lib/analysis/ingestion/budget';
import { runSingleFlight, SingleFlightError, type RedisLikeClient } from '@/lib/analysis/ingestion/single-flight';
import { redis } from '@/lib/redis';
import { ApiError } from '@/lib/rbac';

import { GET as providerQuotaGet } from '@/app/api/cron/provider-quota/route';
import { GET as dailyAnalysisGet } from '@/app/api/cron/daily-analysis/route';
import { GET as providerStatusGet } from '@/app/api/superadmin/analysis/provider-status/route';

const noSleep = async () => {};
const LEASE_KEY = 'provider:quota:refresh:lease';

function env(obj: Record<string, string>): NodeJS.ProcessEnv {
  return obj as unknown as NodeJS.ProcessEnv;
}

// ---------------------------------------------------------------------------
// §3 — Distributed rate limiter: sliding-window algorithm
// ---------------------------------------------------------------------------

/**
 * A faithful JS reference of the Lua sliding-window log (see
 * SLIDING_WINDOW_LUA). Used to *simulate* the algorithm's boundary behaviour
 * without a live Redis. CALCULATED / MOCK-VERIFIED.
 */
function makeSlidingWindow(rps: number, rpm: number) {
  const perSec: number[] = [];
  const perMin: number[] = [];
  // Cumulative history of every granted timestamp (the sliding logs above evict
  // entries, so they cannot be used to count total grants).
  const grants: number[] = [];
  return {
    /** Every granted timestamp (ms), for window-violation assertions. */
    grants,
    reserve(nowMs: number): { allowed: boolean; waitMs: number } {
      while (perSec.length > 0 && perSec[0] <= nowMs - 1_000) perSec.shift();
      while (perMin.length > 0 && perMin[0] <= nowMs - 60_000) perMin.shift();
      if (perSec.length >= rps) return { allowed: false, waitMs: perSec[0] + 1_000 - nowMs };
      if (perMin.length >= rpm) return { allowed: false, waitMs: perMin[0] + 60_000 - nowMs };
      perSec.push(nowMs);
      perMin.push(nowMs);
      grants.push(nowMs);
      return { allowed: true, waitMs: 0 };
    },
  };
}

/** Max number of grants falling inside any `windowMs` sliding window. */
function maxInWindow(times: number[], windowMs: number): number {
  let max = 0;
  for (const t of times) {
    let count = 0;
    for (const u of times) if (u <= t && u > t - windowMs) count += 1;
    max = Math.max(max, count);
  }
  return max;
}

describe('§3 distributed rate limiter — sliding-window algorithm', () => {
  it('does not just rename a fixed-window counter (the Lua is a sorted-set log)', () => {
    // A fixed-window implementation would INCR an epoch-bucket key. The hardened
    // script keeps a sliding log of members scored by timestamp.
    expect(SLIDING_WINDOW_LUA).toMatch(/ZREMRANGEBYSCORE/);
    expect(SLIDING_WINDOW_LUA).toMatch(/ZCARD/);
    expect(SLIDING_WINDOW_LUA).toMatch(/ZADD/);
    expect(SLIDING_WINDOW_LUA).toMatch(/PEXPIRE/);
    expect(SLIDING_WINDOW_LUA).toMatch(/KEYS\[1\]/);
    expect(SLIDING_WINDOW_LUA).toMatch(/KEYS\[2\]/);
    expect(SLIDING_WINDOW_LUA).not.toMatch(/\bINCR\b/);
  });

  it('prevents a burst straddling a second boundary (no window exceeds rps)', () => {
    const limiter = makeSlidingWindow(4, 1_000);
    let granted = 0;
    // Four grants in the last four ms of second 0, then keep offering requests
    // across the boundary. A fixed window would grant four MORE at t>=1000.
    const offered = [996, 997, 998, 999, ...Array.from({ length: 20 }, (_, i) => 1_000 + i)];
    for (const t of offered) if (limiter.reserve(t).allowed) granted += 1;
    expect(maxInWindow(limiter.grants, 1_000)).toBeLessThanOrEqual(4);
    expect(granted).toBe(4); // nothing granted between 1000 and 1019
    // The next grant can only occur once the boundary grant ages out: the grant
    // at t=996 leaves the 1000 ms window only at now >= 1996.
    expect(limiter.reserve(1_995).allowed).toBe(false);
    expect(limiter.reserve(1_996).allowed).toBe(true);
  });

  it('prevents a burst straddling a minute boundary (no window exceeds rpm)', () => {
    const limiter = makeSlidingWindow(100, 3);
    const offered = [59_700, 59_701, 59_702, ...Array.from({ length: 10 }, (_, i) => 60_000 + i)];
    for (const t of offered) limiter.reserve(t);
    expect(maxInWindow(limiter.grants, 60_000)).toBeLessThanOrEqual(3);
    expect(limiter.grants.some((t) => t >= 60_000 && t < 119_700)).toBe(false);
    expect(limiter.reserve(119_700).allowed).toBe(true);
  });

  it('serialises simultaneous reservations — never over-grants a shared final slot', () => {
    const limiter = makeSlidingWindow(4, 1_000);
    const results = Array.from({ length: 10 }, () => limiter.reserve(1_000));
    expect(results.filter((r) => r.allowed)).toHaveLength(4);
    expect(maxInWindow(limiter.grants, 1_000)).toBeLessThanOrEqual(4);
  });

  it('paces sequential acquisitions without ever exceeding the sustained rate', async () => {
    let clock = 0;
    const limiter = makeSlidingWindow(2, 1_000);
    const reserve = async () => limiter.reserve(clock);
    const sleep = async (ms: number) => { clock += ms; };
    for (let i = 0; i < 6; i += 1) {
      await acquireApiFootballSlot({ reserve, sleep, now: () => clock, maxWaitMs: 3_600_000, maxSleepMs: 3_600_000 });
    }
    expect(limiter.grants).toHaveLength(6);
    expect(maxInWindow(limiter.grants, 1_000)).toBeLessThanOrEqual(2);
  });

  it('parses an atomic reservation result and rejects unexpected shapes', () => {
    expect(parseReserveResult([1, 0])).toEqual({ allowed: true, waitMs: 0 });
    expect(parseReserveResult([0, 250])).toEqual({ allowed: false, waitMs: 250 });
    expect(parseReserveResult([0, -5])).toEqual({ allowed: false, waitMs: 0 });
    expect(() => parseReserveResult('nope')).toThrow(ProviderProtectionError);
    expect(() => parseReserveResult([1])).toThrow(ProviderProtectionError);
  });

  it('exposes the configured sustained rate and independent per-second/per-minute ceilings', () => {
    const cfg = getRateLimitConfig();
    expect(cfg.perSecond).toBe(4);
    expect(cfg.perMinute).toBe(240);
  });
});

describe('§3 rate limiter — fail-closed on Redis problems', () => {
  afterEach(() => {
    vi.doUnmock('@/lib/redis');
    vi.resetModules();
  });

  it('fails closed (never bypasses) when Redis is unavailable', async () => {
    vi.resetModules();
    vi.doMock('@/lib/redis', () => ({ redis: { eval: vi.fn().mockRejectedValue(new Error('redis down')) } }));
    const mod = await import('@/lib/api/rate-limiter');
    await expect(mod.acquireApiFootballSlot()).rejects.toBeInstanceOf(mod.ProviderProtectionError);
    await expect(mod.acquireFootballDataSlot()).rejects.toBeInstanceOf(mod.ProviderProtectionError);
  });

  it('fails closed on an unexpected limiter response (no unlimited traffic)', async () => {
    vi.resetModules();
    vi.doMock('@/lib/redis', () => ({ redis: { eval: vi.fn().mockResolvedValue('garbage') } }));
    const mod = await import('@/lib/api/rate-limiter');
    await expect(mod.acquireApiFootballSlot()).rejects.toBeInstanceOf(mod.ProviderProtectionError);
  });
});

// ---------------------------------------------------------------------------
// §2 — Independent Football-Data.org limiter
// ---------------------------------------------------------------------------

describe('§2 Football-Data.org independent limiter', () => {
  const prev = { ...process.env };
  afterEach(() => { process.env = { ...prev }; });

  it('uses a separate key prefix and its own conservative (free-plan) defaults', () => {
    const af = getApiFootballLimiterConfig();
    const fd = getFootballDataLimiterConfig();
    expect(af.keyPrefix).toBe('provider:rl:api-football');
    expect(fd.keyPrefix).toBe('provider:rl:football-data');
    expect(fd.keyPrefix).not.toBe(af.keyPrefix);
    // Documented Free-plan ceiling (10 req/min) — never assume a paid plan.
    expect(fd.rps).toBe(1);
    expect(fd.rpm).toBe(10);
  });

  it('keeps Football-Data.org and API-Football limits completely independent', () => {
    const cfg = getProviderConfig(env({
      FOOTBALL_DATA_RPS: '3',
      FOOTBALL_DATA_RPM: '90',
      FOOTBALL_DATA_MAX_WAIT_MS: '1500',
      FOOTBALL_DATA_MAX_SLEEP_MS: '250',
    }));
    expect(cfg).toMatchObject({
      footballDataRps: 3,
      footballDataRpm: 90,
      footballDataMaxWaitMs: 1_500,
      footballDataMaxSleepMs: 250,
    });
    // The API-Football limits are untouched by the FD variables.
    expect(cfg.apiFootballRps).toBe(4);
    expect(cfg.apiFootballRpm).toBe(240);
  });

  it('reflects independent env configuration in the exposed limiter config', () => {
    process.env.FOOTBALL_DATA_RPS = '5';
    process.env.FOOTBALL_DATA_RPM = '20';
    const fd = getFootballDataRateLimitConfig();
    expect(fd).toEqual({ perSecond: 5, perMinute: 20, maxWaitMs: 10_000 });
    // API-Football config is unaffected.
    expect(getRateLimitConfig()).toEqual({ perSecond: 4, perMinute: 240, maxWaitMs: 10_000 });
  });

  it('reserves a fresh slot for every retry attempt (retries cannot bypass the FD limiter)', async () => {
    let attempts = 0;
    const reserve = vi.fn(async () => ({ allowed: true, waitMs: 0 }));
    await expect(
      withBoundedRetry('fd', async () => {
        attempts += 1;
        await acquireFootballDataSlot({ reserve, sleep: noSleep, now: () => Date.now() });
        throw new ProviderError('boom', { provider: 'football-data', recoverable: true });
      }, { retries: 2, baseDelayMs: 0, sleep: noSleep }),
    ).rejects.toThrow('boom');
    expect(attempts).toBe(3);
    expect(reserve).toHaveBeenCalledTimes(3);
  });

  it('classifies Football-Data.org 429 / auth / quota / server failures correctly', () => {
    const throttled = providerErrorFromResponse('football-data', 429, 'too many requests', '12');
    expect(throttled).toBeInstanceOf(ProviderRateLimitError);
    expect((throttled as ProviderRateLimitError).retryAfterSeconds).toBe(12);

    const quota = providerErrorFromResponse('football-data', 429, 'You reached your daily limit');
    expect(quota).toBeInstanceOf(ProviderQuotaExhaustedError);
    expect(quota.recoverable).toBe(false);

    const auth = providerErrorFromResponse('football-data', 401, 'invalid token');
    expect(auth).toBeInstanceOf(ProviderAuthError);

    const notSubscribed = providerErrorFromResponse('football-data', 403, 'not subscribed to this competition');
    expect(notSubscribed).toBeInstanceOf(ProviderQuotaExhaustedError);

    const server = providerErrorFromResponse('football-data', 503, 'unavailable');
    expect(server).toBeInstanceOf(ProviderError);
    expect(server.recoverable).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// §4 — Daily vs per-minute quota semantics
// ---------------------------------------------------------------------------

describe('§4 quota — daily and per-minute windows never mix', () => {
  it('builds daily + per-minute from /status and headers without mixing', () => {
    const snap = buildQuotaSnapshot({
      requestsCurrent: 100,
      requestsLimitDay: 7_500,
      headers: {
        'x-ratelimit-requests-limit': '7500',
        'x-ratelimit-requests-remaining': '7000',
        'x-ratelimit-limit': '300',
        'x-ratelimit-remaining': '250',
      },
    });
    // DAILY window comes from /status (highest priority), NEVER the per-minute pair.
    expect(snap).toMatchObject({
      dailyLimit: 7_500,
      dailyLimitSource: 'PROVIDER_STATUS',
      consumed: 100,
      consumedSource: 'PROVIDER_STATUS',
      remaining: 7_400,
      // remaining is DERIVED from /status values → INTERNAL_ESTIMATE.
      remainingSource: 'INTERNAL_ESTIMATE',
      status: 'OK',
      source: 'PROVIDER_STATUS',
    });
    // PER-MINUTE window is stored separately and labelled MINUTE_RATE_HEADERS.
    expect(snap.perMinuteLimit).toBe(300);
    expect(snap.perMinuteRemaining).toBe(250);
    expect(snap.perMinuteLimitSource).toBe('MINUTE_RATE_HEADERS');
    expect(snap.perMinuteRemainingSource).toBe('MINUTE_RATE_HEADERS');
  });

  it('falls back to the DAILY header pair when /status daily fields are absent', () => {
    const snap = buildQuotaSnapshot({
      headers: { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' },
    });
    expect(snap).toMatchObject({
      dailyLimit: 7_500,
      dailyLimitSource: 'DAILY_RESPONSE_HEADERS',
      consumed: 500,
      // consumed is DERIVED from the DAILY header pair → INTERNAL_ESTIMATE.
      consumedSource: 'INTERNAL_ESTIMATE',
      remaining: 7_000,
      remainingSource: 'DAILY_RESPONSE_HEADERS',
      source: 'DAILY_RESPONSE_HEADERS',
      status: 'OK',
    });
    expect(snap.perMinuteLimit).toBeNull();
    expect(snap.perMinuteLimitSource).toBe('UNKNOWN');
  });

  it('NEVER derives daily quota from per-minute headers', () => {
    const snap = buildQuotaSnapshot({
      headers: { 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '250' },
    });
    expect(snap.dailyLimit).toBeNull();
    expect(snap.consumed).toBeNull();
    expect(snap.remaining).toBeNull();
    expect(snap.status).toBe('UNKNOWN');
    expect(snap.source).toBe('UNKNOWN');
    // The per-minute values are still surfaced, but only in the per-minute fields.
    expect(snap.perMinuteLimit).toBe(300);
    expect(snap.perMinuteRemaining).toBe(250);
    expect(snap.perMinuteLimitSource).toBe('MINUTE_RATE_HEADERS');
  });

  it('leaves daily UNKNOWN when only a partial DAILY pair is present (never zero)', () => {
    const snap = buildQuotaSnapshot({ headers: { 'x-ratelimit-requests-limit': '7500' } });
    expect(snap.dailyLimit).toBe(7_500);
    expect(snap.consumed).toBeNull();
    expect(snap.remaining).toBeNull();
    expect(snap.status).toBe('UNKNOWN');
  });

  it('represents a missing quota as UNKNOWN, never zero', () => {
    const snap = buildQuotaSnapshot({ headers: {} });
    expect(snap).toMatchObject({ dailyLimit: null, consumed: null, remaining: null, status: 'UNKNOWN', source: 'UNKNOWN' });
    expect(snap.dailyLimitSource).toBe('UNKNOWN');
    expect(snap.consumedSource).toBe('UNKNOWN');
    expect(snap.remainingSource).toBe('UNKNOWN');
    expect(unknownQuotaSnapshot()).toMatchObject({ dailyLimit: null, consumed: null, status: 'UNKNOWN' });
  });

  it('applies the 70 / 85 / 95 % thresholds', () => {
    const base = { ...unknownQuotaSnapshot(), dailyLimit: 7_500 };
    expect(assessQuota({ ...base, consumed: 3_000 }).level).toBe('ok');
    expect(assessQuota({ ...base, consumed: 5_250 }).level).toBe('warning');
    expect(assessQuota({ ...base, consumed: 6_375 }).level).toBe('critical');
    expect(assessQuota({ ...base, consumed: 7_125 }).level).toBe('stop');
  });

  it('marks an aged header snapshot STALE (preserved) rather than current', async () => {
    await redis.del('provider:quota:api-football:headers');
    await storeRateLimitHeaders(
      { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' },
      new Date('2026-11-22T05:00:00.000Z'),
    );
    const stale = await headerQuotaSnapshot(new Date('2026-11-22T06:00:00.000Z'));
    expect(stale?.status).toBe('STALE');
    expect(stale?.dailyLimit).toBe(7_500);
  });

  it('ignores an out-of-order (older) header capture — never overwrites newer', async () => {
    await redis.del('provider:quota:api-football:headers');
    await storeRateLimitHeaders(
      { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' },
      new Date('2026-11-22T08:00:00.000Z'),
    );
    await storeRateLimitHeaders(
      { 'x-ratelimit-requests-limit': '100', 'x-ratelimit-requests-remaining': '50' },
      new Date('2026-11-22T07:00:00.000Z'),
    );
    const stored = await getStoredRateLimitHeaders();
    expect(stored?.limit).toBe(7_500);
    expect(stored?.capturedAt).toBe('2026-11-22T08:00:00.000Z');
  });

  it('captures only the documented numeric headers (per-minute kept separate)', () => {
    const response = {
      headers: {
        get: (name: string) => ({
          'x-ratelimit-requests-limit': '7500',
          'x-ratelimit-requests-remaining': '7400',
          'x-ratelimit-limit': '300',
        }[name.toLowerCase()] ?? null),
      },
    } as unknown as Response;
    expect(captureRateLimitHeaders(response)).toEqual({
      'x-ratelimit-requests-limit': '7500',
      'x-ratelimit-requests-remaining': '7400',
      'x-ratelimit-limit': '300',
    });
  });
});

// ---------------------------------------------------------------------------
// §4/§8 — quota refresh guards
// ---------------------------------------------------------------------------

describe('§4/§8 quota refresh guards', () => {
  const DAY = new Date('2026-11-22T06:00:00.000Z');

  beforeEach(async () => {
    await redis.del(QUOTA_KEY);
    await redis.del(LEASE_KEY);
    hoisted.fetchApiFootballStatus.mockReset();
  });

  it('refreshes from /status and stores a valid daily snapshot', async () => {
    hoisted.fetchApiFootballStatus.mockResolvedValue({
      plan: 'Pro', subscriptionEnd: null, requestsCurrent: 100, requestsLimitDay: 7_500, headers: {},
    });
    const snap = await refreshProviderQuota(DAY);
    expect(snap).toMatchObject({ dailyLimit: 7_500, consumed: 100, remaining: 7_400, status: 'OK', source: 'PROVIDER_STATUS' });
    const stored = await redis.get<typeof snap>(QUOTA_KEY);
    expect(stored?.dailyLimit).toBe(7_500);
  });

  it('never overwrites a newer valid snapshot with an older refresh', async () => {
    await redis.set(QUOTA_KEY, {
      ...unknownQuotaSnapshot(),
      dailyLimit: 7_500, consumed: 200, remaining: 7_300, status: 'OK', source: 'PROVIDER_STATUS',
      lastCheckedAt: '2026-11-22T07:00:00.000Z',
    });
    hoisted.fetchApiFootballStatus.mockResolvedValue({ requestsCurrent: 999, requestsLimitDay: 7_500, headers: {} });
    await refreshProviderQuota(DAY); // older `now` than the stored snapshot
    const stored = await redis.get<{ lastCheckedAt: string; consumed: number }>(QUOTA_KEY);
    expect(stored?.lastCheckedAt).toBe('2026-11-22T07:00:00.000Z');
    expect(stored?.consumed).toBe(200);
  });

  it('never overwrites a valid snapshot with an incomplete (UNKNOWN) refresh', async () => {
    await redis.set(QUOTA_KEY, {
      ...unknownQuotaSnapshot(),
      dailyLimit: 7_500, consumed: 100, remaining: 7_400, status: 'OK', source: 'PROVIDER_STATUS',
      lastCheckedAt: '2026-11-22T05:00:00.000Z',
    });
    hoisted.fetchApiFootballStatus.mockResolvedValue({ headers: {} });
    const snap = await refreshProviderQuota(DAY);
    expect(snap.status).toBe('UNKNOWN');
    const stored = await redis.get<{ dailyLimit: number }>(QUOTA_KEY);
    expect(stored?.dailyLimit).toBe(7_500);
  });

  it('de-duplicates overlapping refreshes with a lease (no duplicate provider poll)', async () => {
    await redis.set(LEASE_KEY, '1', { nx: true, ex: 30 });
    const snap = await refreshProviderQuota(DAY, { dedupeWindowSeconds: 30 });
    expect(hoisted.fetchApiFootballStatus).not.toHaveBeenCalled();
    expect(snap.status).toBe('UNKNOWN');
  });

  it('a failed refresh is never treated as success', async () => {
    hoisted.fetchApiFootballStatus.mockRejectedValue(new Error('provider down'));
    await expect(refreshProviderQuota(DAY)).rejects.toThrow('provider down');
  });
});

// ---------------------------------------------------------------------------
// §5 — Retry-After handling
// ---------------------------------------------------------------------------

describe('§5 Retry-After parsing', () => {
  it('parses integer and fractional seconds', () => {
    expect(parseRetryAfter('120')).toBe(120);
    expect(parseRetryAfter('0')).toBe(0);
    expect(parseRetryAfter('  5 ')).toBe(5);
    expect(parseRetryAfter('1.5')).toBe(1.5);
  });

  it('parses an HTTP-date relative to now (future → positive, past → 0)', () => {
    const now = Date.parse('Wed, 21 Oct 2026 07:27:00 GMT');
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', now)).toBe(60);
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:20:00 GMT', now)).toBe(0);
  });

  it('rejects malformed, negative and empty values safely', () => {
    expect(parseRetryAfter('-1')).toBeUndefined();
    expect(parseRetryAfter('abc')).toBeUndefined();
    expect(parseRetryAfter('')).toBeUndefined();
    expect(parseRetryAfter('   ')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(undefined)).toBeUndefined();
  });
});

describe('§5 bounded retry honours the provider delay', () => {
  it('honours a short Retry-After in full (not clamped to maxDelayMs)', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    let calls = 0;
    const result = await withBoundedRetry('t', async () => {
      calls += 1;
      if (calls === 1) throw new ProviderRateLimitError('api-football', 'slow', 1);
      return 'ok';
    }, { retries: 3, sleep, now: () => 1_000, maxDelayMs: 100, baseDelayMs: 0 });
    expect(result).toBe('ok');
    expect(sleeps).toEqual([1_000]); // exactly Retry-After × 1000, never shortened to 100ms
  });

  it('never retries earlier than the provider requested (long delay kept in full)', async () => {
    const sleeps: number[] = [];
    const sleep = async (ms: number) => { sleeps.push(ms); };
    let calls = 0;
    await withBoundedRetry('t', async () => {
      calls += 1;
      if (calls === 1) throw new ProviderRateLimitError('api-football', 'slow', 30);
      return 'ok';
    }, { retries: 2, sleep, now: () => 0, maxDelayMs: 500 });
    expect(sleeps).toEqual([30_000]);
  });

  it('abandons the retry when the requested delay exceeds the execution budget', async () => {
    let calls = 0;
    const err = new ProviderRateLimitError('api-football', 'slow', 120); // 120s
    await expect(
      withBoundedRetry('t', async () => { calls += 1; throw err; }, { retries: 3, sleep: noSleep, now: () => 0, budgetMs: 60_000 }),
    ).rejects.toBe(err);
    expect(calls).toBe(1); // no retry — we never shorten the delay and retry early
  });

  it('stops when the exponential backoff would exceed the budget', async () => {
    let calls = 0;
    await expect(
      withBoundedRetry('t', async () => {
        calls += 1;
        throw new ProviderError('x', { provider: 'api-football', recoverable: true });
      }, { retries: 3, baseDelayMs: 10_000, sleep: noSleep, now: () => 0, budgetMs: 5_000 }),
    ).rejects.toThrow('x');
    expect(calls).toBe(1);
  });

  it('does not retry authentication or quota failures', async () => {
    let authCalls = 0;
    await expect(
      withBoundedRetry('t', async () => { authCalls += 1; throw new ProviderAuthError('api-football', 401, 'bad key'); },
        { retries: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(ProviderAuthError);
    expect(authCalls).toBe(1);

    let quotaCalls = 0;
    await expect(
      withBoundedRetry('t', async () => { quotaCalls += 1; throw new ProviderQuotaExhaustedError('api-football', 'quota gone'); },
        { retries: 3, sleep: noSleep }),
    ).rejects.toBeInstanceOf(ProviderQuotaExhaustedError);
    expect(quotaCalls).toBe(1);
  });

  it('schedules at most `retries` additional attempts (no retry storm)', async () => {
    let calls = 0;
    await expect(
      withBoundedRetry('t', async () => {
        calls += 1;
        throw new ProviderError('x', { provider: 'api-football', recoverable: true });
      }, { retries: 2, baseDelayMs: 0, sleep: noSleep }),
    ).rejects.toThrow('x');
    expect(calls).toBe(3);
  });

  it('rejects a malformed Retry-After and falls back to bounded backoff', () => {
    const err = providerErrorFromResponse('api-football', 429, 'too many requests', 'not-a-date');
    expect(err).toBeInstanceOf(ProviderRateLimitError);
    expect((err as ProviderRateLimitError).retryAfterSeconds).toBeUndefined();
    // A valid header is parsed.
    const ok = providerErrorFromResponse('api-football', 429, 'too many requests', '3');
    expect((ok as ProviderRateLimitError).retryAfterSeconds).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// §6 — Execution-time budget estimator
// ---------------------------------------------------------------------------

describe('§6 execution-time budget estimator', () => {
  const baseCfg = getProviderConfig(env({}));

  it('derives the worst-case runtime from the verified limits (48 fixtures)', () => {
    const inputs = runtimeInputs(48, baseCfg, { maxRetries: 0 });
    expect(inputs.requestsPerFixture).toBe(ENRICHMENT_REQUESTS_PER_FIXTURE);
    const est = estimateRuntimeMs(inputs);
    expect(est.logicalRequests).toBe(288);
    expect(est.worstCaseRequests).toBe(288);
    expect(est.effectiveRps).toBe(4);
    expect(est.limiterBoundMs).toBe(72_000);
    expect(est.concurrencyBoundMs).toBe(75_000);
    expect(est.estimatedMs).toBe(80_000);
  });

  it('grows with retries (retry-heavy workload)', () => {
    const est = estimateRuntimeMs(runtimeInputs(48, baseCfg, { maxRetries: 2 }));
    expect(est.worstCaseRequests).toBe(864);
    expect(est.limiterBoundMs).toBe(216_000);
    expect(est.estimatedMs).toBe(221_000);
  });

  it('is bounded by the per-minute ceiling when rpm/60 < rps', () => {
    const est = estimateRuntimeMs(runtimeInputs(1, baseCfg, { providerRps: 100, providerRpm: 10, maxRetries: 0 }));
    expect(est.effectiveRps).toBeCloseTo(10 / 60, 5);
    expect(est.limiterBoundMs).toBe(36_000);
  });

  it('flags a realistic maximum workload as exceeding the default invocation budget', () => {
    const est = estimateRuntimeMs(runtimeInputs(400, baseCfg, { maxRetries: 2 }));
    expect(est.estimatedMs).toBeGreaterThan(baseCfg.analysisMaxRuntimeMs);
  });

  it('createRunBudget expires and reports remaining time monotonically', () => {
    let t = 1_000;
    const budget = createRunBudget(5_000, () => t);
    expect(budget.expired()).toBe(false);
    expect(budget.remainingMs()).toBe(5_000);
    t = 6_000;
    expect(budget.expired()).toBe(true);
    expect(budget.remainingMs()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// §7 — Single-flight Redis-outage behaviour
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

describe('§7 single-flight Redis-outage behaviour', () => {
  it('degrades a cache read failure to a miss (never a fabricated hit)', async () => {
    const client = fakeRedis();
    client.get = async () => { throw new Error('redis read down'); };
    const loader = vi.fn(async () => 'loaded');
    const onReadFailure = vi.fn();
    const value = await runSingleFlight({ client, loader, ...baseOptions, onReadFailure });
    expect(value).toBe('loaded');
    expect(onReadFailure).toHaveBeenCalled();
  });

  it('fails closed when Redis locking is unavailable (automated-ingestion policy)', async () => {
    const client = fakeRedis();
    client.set = async () => { throw new Error('redis down'); };
    const loader = vi.fn(async () => 'should-not-run');
    await expect(
      runSingleFlight({ client, loader, ...baseOptions, outagePolicy: 'fail-closed' }),
    ).rejects.toBeInstanceOf(SingleFlightError);
    expect(loader).not.toHaveBeenCalled();
  });

  it('prevents duplicate loads across concurrent cache misses', async () => {
    const client = fakeRedis();
    let loads = 0;
    const loader = async () => { loads += 1; await new Promise((r) => setTimeout(r, 20)); return 'shared'; };
    const [a, b] = await Promise.all([
      runSingleFlight({ client, loader, ...baseOptions }),
      runSingleFlight({ client, loader, ...baseOptions }),
    ]);
    expect(a).toBe('shared');
    expect(b).toBe('shared');
    expect(loads).toBe(1);
  });

  it('releases the lock safely and never fabricates a value after a loader failure', async () => {
    const client = fakeRedis();
    const loader = vi.fn(async () => { throw new Error('loader boom'); });
    await expect(runSingleFlight({ client, loader, ...baseOptions })).rejects.toThrow('loader boom');
    expect(client.store.has('k:__lock')).toBe(false);
    expect(client.store.has('k')).toBe(false);
  });

  it('lets a waiter take over after the owner lock expires (no fabricated result)', async () => {
    const client = fakeRedis();
    await client.set('k:__lock', 'dead-owner', { ex: 30 });
    let loads = 0;
    const loader = async () => { loads += 1; return 'recovered'; };
    setTimeout(() => { client.store.delete('k:__lock'); }, 10);
    const value = await runSingleFlight({ client, loader, ...baseOptions, waitMs: 400, pollMs: 5 });
    expect(value).toBe('recovered');
    expect(loads).toBe(1);
  });

  it('times out a waiter without hanging or fabricating data', async () => {
    const client = fakeRedis();
    await client.set('k:__lock', 'someone-else', { ex: 30 });
    await expect(
      runSingleFlight({ client, loader: async () => 'x', ...baseOptions, waitMs: 20, pollMs: 5 }),
    ).rejects.toBeInstanceOf(SingleFlightError);
  });
});

// ---------------------------------------------------------------------------
// §9 — Provider-scoped metrics
// ---------------------------------------------------------------------------

describe('§9 provider metrics', () => {
  const day = new Date('2033-03-03T06:00:00.000Z');

  it('tracks providers separately and never counts a cache hit as a request', async () => {
    for (const key of [
      'af:httpRequests', 'fd:httpRequests', 'cache:hit', 'quota:refreshSkipped', 'ingestion:deferred',
    ] as const) {
      await redis.del(`provider:metrics:2033-03-03:${key}`);
    }
    await incrProviderMetric('af:httpRequests', day);
    await incrProviderMetric('af:httpRequests', day);
    await incrProviderMetric('fd:httpRequests', day);
    await incrProviderMetric('cache:hit', day);
    await incrProviderMetric('quota:refreshSkipped', day);
    await incrProviderMetric('ingestion:deferred', day);

    const metrics = await readProviderMetrics(day);
    expect(metrics.day).toBe('2033-03-03');
    expect(metrics.apiFootball.httpRequests).toBe(2);
    expect(metrics.footballData.httpRequests).toBe(1);
    expect(metrics.cacheHits).toBe(1);
    expect(metrics.quotaRefreshSkipped).toBe(1);
    expect(metrics.ingestionDeferred).toBe(1);
    // A cache hit is stored on the provider-agnostic cache counter only.
    expect(metrics.apiFootball.httpRequests).toBe(2);
  });

  it('reports missing counters as zero (never fabricated non-zero) and leaks no secrets', async () => {
    const metrics = await readProviderMetrics(new Date('2034-04-04T06:00:00.000Z'));
    expect(metrics.apiFootball.httpRequests).toBe(0);
    expect(metrics.footballData.rateLimitDenied).toBe(0);
    const serialized = JSON.stringify(metrics);
    expect(serialized).not.toMatch(/api[-_]?key|auth[-_]?token|secret|password|redis/i);
  });
});

// ---------------------------------------------------------------------------
// §8/§10 — CRON + superadmin security surface
// ---------------------------------------------------------------------------

describe('§8 provider-quota cron security', () => {
  beforeEach(async () => {
    await redis.del(LEASE_KEY);
    await redis.del(QUOTA_KEY);
    hoisted.fetchApiFootballStatus.mockReset();
  });

  it('rejects a request without the cron secret', async () => {
    const res = await providerQuotaGet(new Request('http://localhost/api/cron/provider-quota') as any);
    expect(res.status).toBe(401);
  });

  it('rejects a request with the wrong cron secret', async () => {
    const res = await providerQuotaGet(new Request('http://localhost/api/cron/provider-quota', {
      headers: { authorization: 'Bearer definitely-wrong' },
    }) as any);
    expect(res.status).toBe(401);
  });

  it('accepts the correct secret and returns a non-secret snapshot', async () => {
    hoisted.fetchApiFootballStatus.mockResolvedValue({
      plan: 'Pro', requestsCurrent: 10, requestsLimitDay: 7_500, headers: {},
    });
    const res = await providerQuotaGet(new Request('http://localhost/api/cron/provider-quota', {
      headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
    }) as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.dailyLimit).toBe(7_500);
    expect(JSON.stringify(body)).not.toContain('test-api-football-key');
  });
});

describe('§8 daily-analysis cron security', () => {
  it('rejects a request without the cron secret', async () => {
    const res = await dailyAnalysisGet(new Request('http://localhost/api/cron/daily-analysis') as any);
    expect(res.status).toBe(401);
    expect(hoisted.runDailyAnalysis).not.toHaveBeenCalled();
  });
});

describe('§10 provider-status superadmin monitoring', () => {
  beforeEach(() => {
    hoisted.requireAnalysisAdmin.mockReset();
    hoisted.analysisRunFindFirst.mockReset();
  });

  it('refuses a non-superadmin caller', async () => {
    hoisted.requireAnalysisAdmin.mockRejectedValue(new ApiError(403, 'Super admin access required'));
    const res = await providerStatusGet(new Request('http://localhost/api/superadmin/analysis/provider-status') as any);
    expect(res.status).toBe(403);
  });

  it('exposes the monitoring payload to a superadmin without leaking secrets', async () => {
    hoisted.requireAnalysisAdmin.mockResolvedValue({});
    hoisted.analysisRunFindFirst.mockResolvedValue(null);
    const res = await providerStatusGet(new Request('http://localhost/api/superadmin/analysis/provider-status') as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('quota');
    expect(body).toHaveProperty('quotaFreshness');
    expect(body).toHaveProperty('rateLimit');
    expect(body).toHaveProperty('footballDataLimiter');
    expect(body).toHaveProperty('cache');
    expect(body).toHaveProperty('singleFlight');
    expect(body).toHaveProperty('circuits');
    expect(body).toHaveProperty('metrics');
    // The FD limiter block is independent of the AF rateLimit block.
    expect(body.footballDataLimiter.requestsPerMinute).toBe(10);
    const text = JSON.stringify(body);
    expect(text).not.toContain('test-api-football-key');
    expect(text).not.toContain('test-football-data-key');
    expect(text).not.toContain(process.env.CRON_SECRET as string);
  });
});
