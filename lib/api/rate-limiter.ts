/**
 * Global distributed provider rate limiters.
 *
 * Every provider request — including retries — must reserve capacity through
 * this module BEFORE the HTTP call. State lives in Redis so the limit holds
 * across every concurrent serverless/worker instance, not just within one
 * process.
 *
 * Algorithm (Stage 3 hardening): a **sliding-window log** implemented as a
 * single atomic Lua script over two Redis sorted sets (per-second and
 * per-minute). Each granted reservation is a member scored by its timestamp;
 * every reservation first evicts members older than the window and then checks
 * the observed count against the ceiling. Unlike the previous fixed
 * epoch-second/epoch-minute counters, a sliding window cannot permit a burst
 * straddling a window boundary (e.g. 4 in the last millisecond of second *N*
 * plus 4 in the first millisecond of second *N+1*): any 1000 ms window can
 * contain at most `rps` grants and any 60 000 ms window at most `rpm` grants.
 *
 * Guarantees:
 *   - Atomic Redis-side reservation (single Lua script — no read-then-write race).
 *   - Correct across multiple serverless instances (shared Redis state).
 *   - No burst that violates the configured sustained rate.
 *   - Independent per-second and per-minute safety ceilings.
 *   - Concurrent reservations are serialised by Redis; two workers can never
 *     both be granted the same final slot.
 *   - Bounded waiting; if a slot cannot be obtained in time we FAIL CLOSED.
 *   - Every retry re-enters the limiter (the caller reserves a fresh slot).
 *
 * API-Football and Football-Data.org have **completely independent** limiters:
 * separate limits, separate Redis keys, separate configuration. A change to one
 * never affects the other.
 *
 * The configured limits are INTERNAL SAFETY LIMITS (see provider-config.ts),
 * not the provider's published plan limits.
 */
import { randomUUID } from 'node:crypto';
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ProviderError, type ProviderName } from '@/lib/api/retry';
import { incrProviderMetric, type ProviderMetricName } from '@/lib/api/provider-metrics';
import { getProviderConfig } from './provider-config';

/** Raised when the provider-protection layer cannot safely permit a request. */
export class ProviderProtectionError extends ProviderError {
  constructor(message: string, provider: ProviderName = 'api-football') {
    super(message, { provider, recoverable: false });
    this.name = 'ProviderProtectionError';
  }
}

/**
 * Atomically reserve one slot in both the per-second and per-minute sliding
 * windows.
 *
 * KEYS[1] = per-second sorted set, KEYS[2] = per-minute sorted set.
 * ARGV[1] = nowMs, ARGV[2] = rps, ARGV[3] = rpm, ARGV[4] = unique member,
 * ARGV[5] = second-window ms, ARGV[6] = minute-window ms.
 * Returns { allowed (1|0), waitMs }.
 *
 * `waitMs` on denial is the time until the oldest member in the blocking window
 * falls out of it, i.e. the earliest a caller could be granted a new slot.
 */
export const SLIDING_WINDOW_LUA = `
local now = tonumber(ARGV[1])
local rps = tonumber(ARGV[2])
local rpm = tonumber(ARGV[3])
local member = ARGV[4]
local secWin = tonumber(ARGV[5])
local minWin = tonumber(ARGV[6])

redis.call('ZREMRANGEBYSCORE', KEYS[1], 0, now - secWin)
redis.call('ZREMRANGEBYSCORE', KEYS[2], 0, now - minWin)

if redis.call('ZCARD', KEYS[1]) >= rps then
  local oldest = redis.call('ZRANGE', KEYS[1], 0, 0, 'WITHSCORES')
  local wait = 0
  if oldest[2] then wait = (tonumber(oldest[2]) + secWin) - now end
  if wait < 0 then wait = 0 end
  return {0, wait}
end

if redis.call('ZCARD', KEYS[2]) >= rpm then
  local oldest = redis.call('ZRANGE', KEYS[2], 0, 0, 'WITHSCORES')
  local wait = 0
  if oldest[2] then wait = (tonumber(oldest[2]) + minWin) - now end
  if wait < 0 then wait = 0 end
  return {0, wait}
end

redis.call('ZADD', KEYS[1], now, member)
redis.call('ZADD', KEYS[2], now, member)
redis.call('PEXPIRE', KEYS[1], secWin + 1000)
redis.call('PEXPIRE', KEYS[2], minWin + 1000)
return {1, 0}
`;

export type LimiterProvider = 'api-football' | 'football-data';

export interface LimiterConfig {
  provider: LimiterProvider;
  /** Redis key prefix, e.g. `provider:rl:api-football`. */
  keyPrefix: string;
  rps: number;
  rpm: number;
  maxWaitMs: number;
  maxSleepMs: number;
}

export interface ReserveResult {
  allowed: boolean;
  /** Milliseconds the caller should wait before re-checking (0 when allowed). */
  waitMs: number;
}

export interface LimiterDeps {
  reserve: (nowMs: number) => Promise<ReserveResult>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  maxWaitMs: number;
  maxSleepMs: number;
  maxAttempts: number;
}

const SECOND_WINDOW_MS = 1_000;
const MINUTE_WINDOW_MS = 60_000;

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** The provider-specific metric name suffix used for wait/denial counters. */
function metricPrefix(provider: LimiterProvider): 'af' | 'fd' {
  return provider === 'api-football' ? 'af' : 'fd';
}

/** Redis-backed reserve using the atomic sliding-window Lua script. Fails closed. */
async function redisReserve(cfg: LimiterConfig, nowMs: number): Promise<ReserveResult> {
  const member = `${cfg.provider}:${nowMs}:${randomUUID()}`;
  const raw = await redis.eval(
    SLIDING_WINDOW_LUA,
    [`${cfg.keyPrefix}:s`, `${cfg.keyPrefix}:m`],
    [nowMs, cfg.rps, cfg.rpm, member, SECOND_WINDOW_MS, MINUTE_WINDOW_MS],
  );
  return parseReserveResult(raw, cfg.provider);
}

/** Parse the Lua/2-tuple `[allowed, waitMs]` into a typed result (defensive). */
export function parseReserveResult(raw: unknown, provider: ProviderName = 'api-football'): ReserveResult {
  if (Array.isArray(raw) && raw.length >= 2) {
    const allowed = Number(raw[0]) === 1;
    const waitMs = Number(raw[1]);
    return { allowed, waitMs: Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 0 };
  }
  // Unknown shape: treat as NOT allowed rather than risk unlimited traffic.
  throw new ProviderProtectionError(`${provider} rate limiter returned an unexpected response`, provider);
}

/**
 * Acquire one request slot from a provider limiter, waiting (bounded) when the
 * permitted rate is reached. Throws {@link ProviderProtectionError} if it
 * cannot obtain a slot within `maxWaitMs` or if Redis is unavailable.
 */
export async function acquireProviderSlot(
  cfg: LimiterConfig,
  deps: Partial<LimiterDeps> = {},
): Promise<void> {
  const prefix = metricPrefix(cfg.provider);
  const waitMetric: ProviderMetricName = `${prefix}:rateLimitWait`;
  const deniedMetric: ProviderMetricName = `${prefix}:rateLimitDenied`;
  const d: LimiterDeps = {
    reserve: deps.reserve ?? ((nowMs) => reserveWithRedis(cfg, nowMs)),
    sleep: deps.sleep ?? defaultSleep,
    now: deps.now ?? Date.now,
    maxWaitMs: deps.maxWaitMs ?? cfg.maxWaitMs,
    maxSleepMs: deps.maxSleepMs ?? cfg.maxSleepMs,
    maxAttempts: deps.maxAttempts ?? 50,
  };

  let waited = 0;
  for (let attempt = 0; attempt < d.maxAttempts; attempt += 1) {
    const { allowed, waitMs } = await d.reserve(d.now());
    if (allowed) {
      if (waited > 0) logger.info('provider.rateLimit.acquired', { provider: cfg.provider, waitedMs: waited });
      return;
    }
    const wait = Math.min(Math.max(waitMs, 50), d.maxSleepMs);
    if (waited + wait > d.maxWaitMs) {
      logger.warn('provider.rateLimit.waitExceeded', { provider: cfg.provider, waitedMs: waited, maxWaitMs: d.maxWaitMs });
      void incrProviderMetric(deniedMetric);
      throw new ProviderProtectionError(`${cfg.provider} rate limit wait exceeded ${d.maxWaitMs}ms`, cfg.provider);
    }
    logger.warn('provider.rateLimit.wait', { provider: cfg.provider, waitMs: wait, waitedMs: waited });
    void incrProviderMetric(waitMetric);
    await d.sleep(wait);
    waited += wait;
  }
  void incrProviderMetric(deniedMetric);
  throw new ProviderProtectionError(`${cfg.provider} rate limit retries exhausted`, cfg.provider);
}

/** Wrap Redis reservation so a Redis failure fails closed (never bypasses). */
async function reserveWithRedis(cfg: LimiterConfig, nowMs: number): Promise<ReserveResult> {
  try {
    return await redisReserve(cfg, nowMs);
  } catch (err) {
    if (err instanceof ProviderProtectionError) throw err;
    throw new ProviderProtectionError(
      `${cfg.provider} rate limiter unavailable (Redis error): ${err instanceof Error ? err.message : String(err)}`,
      cfg.provider,
    );
  }
}

export function getApiFootballLimiterConfig(): LimiterConfig {
  const cfg = getProviderConfig();
  return {
    provider: 'api-football',
    keyPrefix: 'provider:rl:api-football',
    rps: cfg.apiFootballRps,
    rpm: cfg.apiFootballRpm,
    maxWaitMs: cfg.apiFootballMaxWaitMs,
    maxSleepMs: cfg.apiFootballMaxSleepMs,
  };
}

export function getFootballDataLimiterConfig(): LimiterConfig {
  const cfg = getProviderConfig();
  return {
    provider: 'football-data',
    keyPrefix: 'provider:rl:football-data',
    rps: cfg.footballDataRps,
    rpm: cfg.footballDataRpm,
    maxWaitMs: cfg.footballDataMaxWaitMs,
    maxSleepMs: cfg.footballDataMaxSleepMs,
  };
}

/** Acquire one API-Football slot (independent limiter). */
export async function acquireApiFootballSlot(deps: Partial<LimiterDeps> = {}): Promise<void> {
  return acquireProviderSlot(getApiFootballLimiterConfig(), deps);
}

/** Acquire one Football-Data.org slot (independent limiter). */
export async function acquireFootballDataSlot(deps: Partial<LimiterDeps> = {}): Promise<void> {
  return acquireProviderSlot(getFootballDataLimiterConfig(), deps);
}

/** Exposed for monitoring/documentation (API-Football, legacy shape). */
export function getRateLimitConfig(): { perSecond: number; perMinute: number; maxWaitMs: number } {
  const cfg = getApiFootballLimiterConfig();
  return { perSecond: cfg.rps, perMinute: cfg.rpm, maxWaitMs: cfg.maxWaitMs };
}

/** Exposed for monitoring/documentation (Football-Data.org). */
export function getFootballDataRateLimitConfig(): { perSecond: number; perMinute: number; maxWaitMs: number } {
  const cfg = getFootballDataLimiterConfig();
  return { perSecond: cfg.rps, perMinute: cfg.rpm, maxWaitMs: cfg.maxWaitMs };
}
