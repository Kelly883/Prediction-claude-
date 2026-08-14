import { redis } from './redis';

const CACHE_TTL_SECONDS = Number(process.env.FX_CACHE_TTL_SECONDS ?? 6 * 60 * 60); // 6h (design doc Section 9)

/**
 * Caching is an optimization, not a requirement — if Redis is unreachable
 * or misconfigured, the correct behavior is "skip the cache, fetch live
 * every time" (slower, still correct), not "fail the whole subscription
 * attempt." Same fail-open reasoning as lib/ratelimit.ts, applied here
 * since this sits on the payment path: a non-Nigerian user subscribing
 * calls this to convert NGN to USD, and a Redis outage shouldn't be able
 * to block that.
 */
export async function getFxRate(from: string, to: string): Promise<number> {
  const cacheKey = `fx:${from}:${to}`;

  try {
    const cached = await redis.get<number>(cacheKey);
    if (cached) return cached;
  } catch (err) {
    console.error('FX cache read failed, fetching live rate instead:', err);
  }

  const rate = await fetchFromProvider(from, to);

  try {
    await redis.set(cacheKey, rate, { ex: CACHE_TTL_SECONDS });
  } catch (err) {
    console.error('FX cache write failed (rate still returned, just not cached):', err);
  }

  return rate;
}

async function fetchFromProvider(from: string, to: string): Promise<number> {
  const res = await fetch(`https://api.exchangerate.host/convert?from=${from}&to=${to}`);
  if (!res.ok) throw new Error(`FX provider error: ${res.status}`);
  const data = await res.json();
  return data.result as number;
}
