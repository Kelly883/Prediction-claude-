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
    if (cached && typeof cached === 'number' && !isNaN(cached) && cached > 0) {
      return cached;
    }
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
  const fromUpper = from.toUpperCase();
  const toUpper = to.toUpperCase();

  // 1. Primary: open.er-api.com (No API key needed, reliable real-time rates)
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${fromUpper}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates && typeof data.rates[toUpper] === 'number') {
        return Number(data.rates[toUpper]);
      }
      // In case the response is in a legacy result format
      if (typeof data.result === 'number') {
        return Number(data.result);
      }
    }
  } catch (err) {
    console.warn(`Primary FX provider failed for ${fromUpper}->${toUpper}:`, err);
  }

  // 2. Secondary fallback: fawazahmed0 currency API
  try {
    const res = await fetch(
      `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/${from.toLowerCase()}.json`,
      {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      }
    );
    if (res.ok) {
      const data = await res.json();
      const fromRates = data[from.toLowerCase()];
      if (fromRates && typeof fromRates[to.toLowerCase()] === 'number') {
        return Number(fromRates[to.toLowerCase()]);
      }
    }
  } catch (err) {
    console.warn(`Secondary FX provider failed for ${from}->${to}:`, err);
  }

  // 3. Static fallback rates to guarantee payments never break even under total provider downtime
  if (fromUpper === 'NGN' && toUpper === 'USD') return 1 / 1450; // ~0.00069 USD per NGN
  if (fromUpper === 'USD' && toUpper === 'NGN') return 1450;
  if (fromUpper === toUpper) return 1;

  throw new Error(`Unable to determine FX conversion rate for ${from} to ${to}`);
}
