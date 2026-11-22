import { redis } from '@/lib/redis';

/**
 * Provider request quota tracker.
 *
 * Enforces a hard cap on provider requests within a rolling window using an
 * atomic Redis Lua check-and-increment. This prevents silently exceeding a
 * provider's plan limit (e.g. API-Football free tier = 100 requests/day) and
 * burning through quota on the first run, which would otherwise surface only as
 * cascading 429s mid-pipeline.
 *
 * Design:
 *  - One counter key per (provider, window bucket), aligned to the window so
 *    old keys expire naturally and never affect the current window's count.
 *  - The check-and-increment is a single Lua script => atomic across all
 *    serverless instances sharing the same Redis, so concurrent runs cannot
 *    collectively overshoot the limit.
 *  - Only providers with a known hard cap are tracked. football-data's limit is
 *    per-minute (handled gracefully by 429 retry/backoff), so it is not gated
 *    here.
 *  - Fail-open on quota-store errors with a warning: a Redis outage must not
 *    block analysis. (In production the run already fails closed earlier if the
 *    Redis lock is unavailable, so this path is defensive.)
 */
export interface QuotaStatus {
  allowed: boolean;
  used: number;
  limit: number;
}

export class QuotaExceededError extends Error {
  constructor(
    public readonly providerLabel: string,
    public readonly used: number,
    public readonly limit: number,
  ) {
    super(
      `${providerLabel} request quota exhausted (${used}/${limit}); ` +
        'skipping provider call to avoid exceeding the plan limit',
    );
    this.name = 'QuotaExceededError';
  }
}

function providerQuota(provider: string): { limit: number; windowSeconds: number } | undefined {
  if (provider === 'api-football') {
    const limit = Number(process.env.FOOTBALL_API_DAILY_LIMIT ?? 100);
    if (Number.isFinite(limit) && limit > 0) {
      return { limit, windowSeconds: 24 * 60 * 60 };
    }
  }
  // football-data (per-minute) and any unlisted provider: no hard cap here.
  return undefined;
}

function quotaKey(provider: string, windowSeconds: number, now: Date): string {
  const bucket = Math.floor(now.getTime() / (windowSeconds * 1000));
  return `quota:${provider}:${bucket}`;
}

// KEYS[1] = counter key; ARGV = [cost, limit, windowSeconds].
// Returns {allowed(0|1), used}.
const CHECK_AND_INCR = `
local current = tonumber(redis.call('GET', KEYS[1]) or '0')
local cost = tonumber(ARGV[1])
local limit = tonumber(ARGV[2])
if current + cost > limit then
  return {0, current}
end
local updated = redis.call('INCRBY', KEYS[1], cost)
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return {1, updated}
`;

/**
 * Atomically reserve `cost` units of provider quota. Returns whether the
 * request is allowed and the current usage. When the provider has no configured
 * quota, the request is always allowed.
 */
export async function reserveQuota(
  provider: string,
  cost = 1,
  now: Date = new Date(),
): Promise<QuotaStatus> {
  const config = providerQuota(provider);
  if (!config) return { allowed: true, used: 0, limit: Infinity };

  const key = quotaKey(provider, config.windowSeconds, now);
  try {
    const [allowed, used] = (await redis.eval(CHECK_AND_INCR, [key], [
      String(cost),
      String(config.limit),
      String(config.windowSeconds),
    ])) as [number, number];
    return { allowed: allowed === 1, used: Number(used) || 0, limit: config.limit };
  } catch (err) {
    console.warn(`Quota reserve failed for ${provider}; allowing request`, err);
    return { allowed: true, used: 0, limit: config.limit };
  }
}

/** Read-only view of current provider usage (does not consume quota). */
export async function getQuotaStatus(provider: string, now: Date = new Date()): Promise<QuotaStatus> {
  const config = providerQuota(provider);
  if (!config) return { allowed: true, used: 0, limit: Infinity };

  const key = quotaKey(provider, config.windowSeconds, now);
  try {
    const used = Number((await redis.get<number>(key)) ?? 0) || 0;
    return { allowed: used < config.limit, used, limit: config.limit };
  } catch (err) {
    console.warn(`Quota status failed for ${provider}`, err);
    return { allowed: true, used: 0, limit: config.limit };
  }
}