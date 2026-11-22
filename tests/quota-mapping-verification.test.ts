/**
 * API-FOOTBALL v3 quota-mapping verification.
 *
 * Verifies the provider quota implementation against the DOCUMENTED API-FOOTBALL
 * `/status` response shape and the DOCUMENTED response headers, and demonstrates
 * the distributed limiter's burst behaviour versus a fixed-window counter.
 *
 * Evidence: everything here is MOCK-VERIFIED / CALCULATED — Redis is mocked and
 * the `/status` HTTP call is stubbed. NO live provider request is made, so the
 * live account quota, subscription entitlement and real header names remain
 * NOT VERIFIED.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const hoisted = vi.hoisted(() => ({
  evalMock: vi.fn(),
  getMock: vi.fn(),
  setMock: vi.fn(),
  delMock: vi.fn(),
  incrMock: vi.fn(),
  expireMock: vi.fn(),
}));

// Mock the Redis layer so the limiter can be observed and made to fail, without
// touching real Redis / the in-memory fallback.
vi.mock('@/lib/redis', () => ({
  redis: {
    eval: hoisted.evalMock,
    get: hoisted.getMock,
    set: hoisted.setMock,
    del: hoisted.delMock,
    incr: hoisted.incrMock,
    expire: hoisted.expireMock,
  },
  isDistributedRedisConfigured: () => false,
}));

import { assessQuota, buildQuotaSnapshot, unknownQuotaSnapshot } from '@/lib/api/quota';
import { fetchApiFootballStatus } from '@/lib/api/football-api';
import { SLIDING_WINDOW_LUA } from '@/lib/api/rate-limiter';

beforeEach(() => {
  hoisted.evalMock.mockReset().mockResolvedValue([1, 0]); // limiter: granted
  hoisted.getMock.mockReset().mockResolvedValue(null); // circuit closed / no cached value
  hoisted.setMock.mockReset().mockResolvedValue('OK');
  hoisted.delMock.mockReset().mockResolvedValue(1);
  hoisted.incrMock.mockReset().mockResolvedValue(1);
  hoisted.expireMock.mockReset().mockResolvedValue(1);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/**
 * The documented API-FOOTBALL `/status` response (fields we consume only).
 * Source: official API-FOOTBALL v3 documentation. DOCUMENTATION-VERIFIED shape;
 * the live account values are NOT VERIFIED.
 */
const STATUS_EXAMPLE = {
  get: 'status',
  parameters: [],
  errors: [],
  results: 1,
  paging: { current: 1, total: 1 },
  response: {
    account: { firstname: 'Jane', lastname: 'Doe', email: 'jane@example.com' },
    subscription: { plan: 'Free', end: '2027-01-01T00:00:00+00:00', active: true },
    requests: { current: 100, limit_day: 100 },
  },
};

const STATUS_HEADERS = {
  'content-type': 'application/json',
  // DAILY window.
  'x-ratelimit-requests-limit': '100',
  'x-ratelimit-requests-remaining': '0',
  // PER-MINUTE window.
  'x-ratelimit-limit': '10',
  'x-ratelimit-remaining': '7',
};

function stubStatusResponse(example: unknown, headers: Record<string, string>) {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify(example), { status: 200, headers }));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

// ---------------------------------------------------------------------------
// §1/§5 — /status: field mapping, limiter pass-through, quota exclusion
// ---------------------------------------------------------------------------

describe('/status — mapping, limiter pass-through and daily-quota exclusion', () => {
  it('maps the documented /status response and passes through the distributed limiter', async () => {
    stubStatusResponse(STATUS_EXAMPLE, STATUS_HEADERS);

    const status = await fetchApiFootballStatus();

    // The /status call reserved a slot in the shared distributed limiter.
    expect(hoisted.evalMock).toHaveBeenCalled();
    // `/status` does NOT count against the daily quota — the returned `current`
    // is the provider's own counter and is taken verbatim (no +1 for this call).
    expect(status.requestsCurrent).toBe(100);
    expect(status.requestsLimitDay).toBe(100);
    // Plan metadata is read; account identity (name/email) is never surfaced.
    expect(status.plan).toBe('Free');
    expect(status.active).toBe(true);
    expect(status).not.toHaveProperty('email');

    // Both header windows were captured, kept distinct.
    expect(status.headers['x-ratelimit-requests-remaining']).toBe('0');
    expect(status.headers['x-ratelimit-limit']).toBe('10');
  });

  it('builds daily + per-minute figures from /status + headers without mixing', async () => {
    stubStatusResponse(STATUS_EXAMPLE, STATUS_HEADERS);
    const status = await fetchApiFootballStatus();
    const snap = buildQuotaSnapshot(status, new Date('2026-11-22T06:00:00.000Z'));

    expect(snap).toMatchObject({
      source: 'PROVIDER_STATUS',
      dailyLimit: 100,
      dailyLimitSource: 'PROVIDER_STATUS',
      consumed: 100,
      consumedSource: 'PROVIDER_STATUS',
      remaining: 0,
      remainingSource: 'INTERNAL_ESTIMATE',
      perMinuteLimit: 10,
      perMinuteLimitSource: 'MINUTE_RATE_HEADERS',
      perMinuteRemaining: 7,
      perMinuteRemainingSource: 'MINUTE_RATE_HEADERS',
      status: 'OK',
    });
    // Daily quota exhausted → the gate blocks.
    expect(assessQuota(snap).level).toBe('stop');
  });

  it('fails closed (no HTTP request) when the limiter cannot reserve a slot', async () => {
    hoisted.evalMock.mockRejectedValue(new Error('redis down'));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchApiFootballStatus()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// §6 — snapshot records the source of every value
// ---------------------------------------------------------------------------

describe('quota snapshot — per-value provenance', () => {
  it('labels every value read from /status (and derives remaining as INTERNAL_ESTIMATE)', () => {
    const snap = buildQuotaSnapshot(
      { requestsCurrent: 120, requestsLimitDay: 7_500, headers: {} },
      new Date('2026-11-22T06:00:00.000Z'),
    );
    expect(snap.source).toBe('PROVIDER_STATUS');
    expect(snap.dailyLimitSource).toBe('PROVIDER_STATUS');
    expect(snap.consumedSource).toBe('PROVIDER_STATUS');
    expect(snap.remainingSource).toBe('INTERNAL_ESTIMATE');
    expect(snap.remaining).toBe(7_380);
  });

  it('labels the DAILY header pair as DAILY_RESPONSE_HEADERS and derives consumed', () => {
    const snap = buildQuotaSnapshot(
      { headers: { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '7000' } },
    );
    expect(snap.source).toBe('DAILY_RESPONSE_HEADERS');
    expect(snap.dailyLimitSource).toBe('DAILY_RESPONSE_HEADERS');
    expect(snap.remainingSource).toBe('DAILY_RESPONSE_HEADERS');
    expect(snap.consumed).toBe(500);
    expect(snap.consumedSource).toBe('INTERNAL_ESTIMATE');
  });

  it('labels per-minute headers as MINUTE_RATE_HEADERS (never daily)', () => {
    const snap = buildQuotaSnapshot({ headers: { 'x-ratelimit-limit': '300', 'x-ratelimit-remaining': '250' } });
    expect(snap.perMinuteLimitSource).toBe('MINUTE_RATE_HEADERS');
    expect(snap.perMinuteRemainingSource).toBe('MINUTE_RATE_HEADERS');
    // Daily stays UNKNOWN — a per-minute header is NEVER a daily value.
    expect(snap.source).toBe('UNKNOWN');
    expect(snap.dailyLimitSource).toBe('UNKNOWN');
    expect(snap.status).toBe('UNKNOWN');
  });

  it('labels an empty capture as UNKNOWN for every value (never zero)', () => {
    const snap = buildQuotaSnapshot({ headers: {} });
    expect(snap).toMatchObject({
      dailyLimit: null, dailyLimitSource: 'UNKNOWN',
      consumed: null, consumedSource: 'UNKNOWN',
      remaining: null, remainingSource: 'UNKNOWN',
      perMinuteLimit: null, perMinuteLimitSource: 'UNKNOWN',
      perMinuteRemaining: null, perMinuteRemainingSource: 'UNKNOWN',
      source: 'UNKNOWN', status: 'UNKNOWN',
    });
    expect(unknownQuotaSnapshot()).toMatchObject({ dailyLimitSource: 'UNKNOWN', perMinuteLimitSource: 'UNKNOWN' });
  });
});

// ---------------------------------------------------------------------------
// §3/§4 — missing, contradictory, zero and stale
// ---------------------------------------------------------------------------

describe('quota edge cases — missing, contradictory, zero, stale', () => {
  it('leaves daily UNKNOWN for a partial DAILY pair (missing field is not zero)', () => {
    const limitOnly = buildQuotaSnapshot({ headers: { 'x-ratelimit-requests-limit': '7500' } });
    expect(limitOnly.dailyLimit).toBe(7_500);
    expect(limitOnly.remaining).toBeNull();
    expect(limitOnly.consumed).toBeNull();
    expect(limitOnly.status).toBe('UNKNOWN');

    const remainingOnly = buildQuotaSnapshot({ headers: { 'x-ratelimit-requests-remaining': '0' } });
    expect(remainingOnly.dailyLimit).toBeNull();
    // A remaining of 0 with no limit is UNKNOWN, NOT "zero quota".
    expect(remainingOnly.status).toBe('UNKNOWN');
    expect(assessQuota(remainingOnly).level).toBe('unknown');
  });

  it('does not let contradictory header values cross into the /status daily window', () => {
    // /status is authoritative; a contradicting DAILY header must be ignored.
    const snap = buildQuotaSnapshot({
      requestsCurrent: 100,
      requestsLimitDay: 7_500,
      headers: {
        'x-ratelimit-requests-limit': '999',
        'x-ratelimit-requests-remaining': '1',
      },
    });
    expect(snap.source).toBe('PROVIDER_STATUS');
    expect(snap.dailyLimit).toBe(7_500); // not 999
    expect(snap.remaining).toBe(7_400); // not 1
    expect(snap.remaining).not.toBe(1);
  });

  it('clamps a contradictory header pair (remaining > limit) instead of inventing consumption', () => {
    const snap = buildQuotaSnapshot({ headers: { 'x-ratelimit-requests-limit': '100', 'x-ratelimit-requests-remaining': '150' } });
    expect(snap.dailyLimit).toBe(100);
    expect(snap.remaining).toBe(150);
    // Derived consumption is floored at 0 — we never invent a negative value.
    expect(snap.consumed).toBe(0);
  });

  it('treats zero remaining daily quota as the stop level, not UNKNOWN', () => {
    const fromStatus = buildQuotaSnapshot({ requestsCurrent: 100, requestsLimitDay: 100, headers: {} });
    expect(fromStatus.remaining).toBe(0);
    expect(fromStatus.status).toBe('OK');
    expect(assessQuota(fromStatus).level).toBe('stop');

    const fromHeaders = buildQuotaSnapshot({ headers: { 'x-ratelimit-requests-limit': '7500', 'x-ratelimit-requests-remaining': '0' } });
    expect(fromHeaders.remaining).toBe(0);
    expect(assessQuota(fromHeaders).level).toBe('stop');
  });

  it('marks a stale snapshot as stale (preserved) rather than current', () => {
    const stale = { ...unknownQuotaSnapshot(), dailyLimit: 7_500, consumed: 100, status: 'STALE' as const };
    expect(assessQuota(stale).level).toBe('stale');
    expect(assessQuota(stale).consumedRatio).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// §8 — fixed-window boundary burst vs. distributed sliding window
// ---------------------------------------------------------------------------

/** Reference fixed-window counter (epoch-second bucket), the OLD approach. */
function fixedWindowReserve(state: { bucket: number; count: number }, nowMs: number, rps: number): boolean {
  const bucket = Math.floor(nowMs / 1_000);
  if (state.bucket !== bucket) {
    state.bucket = bucket;
    state.count = 0;
  }
  if (state.count >= rps) return false;
  state.count += 1;
  return true;
}

/** Reference sliding-window log matching SLIDING_WINDOW_LUA (per-second only). */
function slidingWindowReserve(log: number[], nowMs: number, rps: number): boolean {
  while (log.length > 0 && log[0] <= nowMs - 1_000) log.shift();
  if (log.length >= rps) return false;
  log.push(nowMs);
  return true;
}

function maxInWindow(times: number[], windowMs: number): number {
  let max = 0;
  for (const t of times) {
    let count = 0;
    for (const u of times) if (u <= t && u > t - windowMs) count += 1;
    max = Math.max(max, count);
  }
  return max;
}

describe('§8 fixed-window vs sliding-window burst behaviour', () => {
  const offered = [996, 997, 998, 999, 1_000, 1_001, 1_002, 1_003];

  it('demonstrates the fixed-window counter PERMITS a boundary burst', () => {
    const state = { bucket: -1, count: 0 };
    const granted: number[] = [];
    for (const t of offered) if (fixedWindowReserve(state, t, 4)) granted.push(t);
    // 4 at the end of second 0 + 4 at the start of second 1 = 8 within 8ms,
    // double the configured 4/s sustained rate.
    expect(granted).toEqual(offered);
    expect(maxInWindow(granted, 1_000)).toBe(8);
  });

  it('shows the sliding-window log PREVENTS the same boundary burst', () => {
    const log: number[] = [];
    const granted: number[] = [];
    for (const t of offered) if (slidingWindowReserve(log, t, 4)) granted.push(t);
    expect(granted).toEqual([996, 997, 998, 999]); // nothing more across the boundary
    expect(maxInWindow(granted, 1_000)).toBeLessThanOrEqual(4);
  });

  it('confirms the shipped limiter is a sliding-window log, not a fixed-window counter', () => {
    expect(SLIDING_WINDOW_LUA).toMatch(/ZREMRANGEBYSCORE/);
    expect(SLIDING_WINDOW_LUA).toMatch(/ZCARD/);
    expect(SLIDING_WINDOW_LUA).toMatch(/ZADD/);
    expect(SLIDING_WINDOW_LUA).not.toMatch(/\bINCR\b/);
  });
});
