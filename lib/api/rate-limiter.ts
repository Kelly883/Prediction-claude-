/**
 * Global distributed API-Football rate limiter.
 *
 * Every API-Football request — including retries — must reserve capacity
 * through this module BEFORE the HTTP call. State lives in Redis so the limit
 * holds across every concurrent serverless/worker instance, not just within one
 * process.
 *
 * Design:
 *   - Two fixed windows (per-second and per-minute) are incremented atomically
 *     by a single Lua script, so two workers can never both be granted the same
 *     final slot.
 *   - If the permitted rate is reached the caller waits and re-checks.
 *   - If Redis is unavailable we FAIL CLOSED for automated ingestion: we never
 *     silently bypass the distributed limiter and never allow unlimited traffic.
 *
 * The configured limits are INTERNAL SAFETY LIMITS (see provider-config.ts),
 * not the provider's published plan limits.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ProviderError } from '@/lib/api/retry';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { getProviderConfig } from './provider-config';

/** Raised when the provider-protection layer cannot safely permit a request. */
export class ProviderProtectionError extends ProviderError {
  constructor(message: string) {
    super(message, { provider: 'api-football', recoverable: false });
    this.name = 'ProviderProtectionError';
  }
}

/**
 * Atomically reserve one slot in both the per-second and per-minute windows.
 * KEYS[1]=second key, KEYS[2]=minute key.
 * ARGV[1]=rps, ARGV[2]=rpm, ARGV[3]=second TTL ms, ARGV[4]=minute TTL ms.
 * Returns { allowed (1|0), waitMs }.
 */
export const RATE_LIMIT_LUA = `
local sec = redis.call('INCR', KEYS[1])
if sec == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[3]) end
if sec > tonumber(ARGV[1]) then
  local ttl = redis.call('PTTL', KEYS[1])
  if ttl < 0 then ttl = 0 end
  return {0, ttl}
end
local minute = redis.call('INCR', KEYS[2])
if minute == 1 then redis.call('PEXPIRE', KEYS[2], ARGV[4]) end
if minute > tonumber(ARGV[2]) then
  local ttl = redis.call('PTTL', KEYS[2])
  if ttl < 0 then ttl = 0 end
  return {0, ttl}
end
return {1, 0}
`;

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

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

/** Redis-backed reserve using the atomic Lua script. Fails closed on error. */
async function redisReserve(nowMs: number): Promise<ReserveResult> {
  const cfg = getProviderConfig();
  const secondKey = `provider:rl:api-football:s:${Math.floor(nowMs / 1000)}`;
  const minuteKey = `provider:rl:api-football:m:${Math.floor(nowMs / 60_000)}`;
  let raw: unknown;
  try {
    raw = await redis.eval(
      RATE_LIMIT_LUA,
      [secondKey, minuteKey],
      [cfg.apiFootballRps, cfg.apiFootballRpm, 1_500, 65_000],
    );
  } catch (err) {
    // Fail closed: no Redis => no distributed limiter => no automated requests.
    throw new ProviderProtectionError(
      `API-Football rate limiter unavailable (Redis error): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return parseReserveResult(raw);
}

/** Parse the Lua/2-tuple `[allowed, waitMs]` into a typed result (defensive). */
export function parseReserveResult(raw: unknown): ReserveResult {
  if (Array.isArray(raw) && raw.length >= 2) {
    const allowed = Number(raw[0]) === 1;
    const waitMs = Number(raw[1]);
    return { allowed, waitMs: Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 0 };
  }
  // Unknown shape: treat as NOT allowed rather than risk unlimited traffic.
  throw new ProviderProtectionError('API-Football rate limiter returned an unexpected response');
}

/**
 * Acquire one API-Football request slot, waiting (bounded) when the permitted
 * rate is reached. Throws {@link ProviderProtectionError} if it cannot obtain a
 * slot within `maxWaitMs` or if the limiter is unavailable.
 */
export async function acquireApiFootballSlot(deps: Partial<LimiterDeps> = {}): Promise<void> {
  const cfg = getProviderConfig();
  const d: LimiterDeps = {
    reserve: deps.reserve ?? redisReserve,
    sleep: deps.sleep ?? defaultSleep,
    now: deps.now ?? Date.now,
    maxWaitMs: deps.maxWaitMs ?? cfg.apiFootballMaxWaitMs,
    maxSleepMs: deps.maxSleepMs ?? cfg.apiFootballMaxSleepMs,
    maxAttempts: deps.maxAttempts ?? 50,
  };

  let waited = 0;
  for (let attempt = 0; attempt < d.maxAttempts; attempt += 1) {
    const { allowed, waitMs } = await d.reserve(d.now());
    if (allowed) {
      if (waited > 0) logger.info('provider.rateLimit.acquired', { waitedMs: waited });
      void incrProviderMetric('provider:requests');
      return;
    }
    const wait = Math.min(Math.max(waitMs, 50), d.maxSleepMs);
    if (waited + wait > d.maxWaitMs) {
      logger.warn('provider.rateLimit.waitExceeded', { waitedMs: waited, maxWaitMs: d.maxWaitMs });
      throw new ProviderProtectionError(`API-Football rate limit wait exceeded ${d.maxWaitMs}ms`);
    }
    logger.warn('provider.rateLimit.wait', { waitMs: wait, waitedMs: waited });
    void incrProviderMetric('provider:rateLimitWait');
    await d.sleep(wait);
    waited += wait;
  }
  throw new ProviderProtectionError('API-Football rate limit retries exhausted');
}

/** Exposed for monitoring/documentation. */
export function getRateLimitConfig(): { perSecond: number; perMinute: number; maxWaitMs: number } {
  const cfg = getProviderConfig();
  return { perSecond: cfg.apiFootballRps, perMinute: cfg.apiFootballRpm, maxWaitMs: cfg.apiFootballMaxWaitMs };
}
