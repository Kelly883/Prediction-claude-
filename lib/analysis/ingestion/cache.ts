import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { ProviderAuthError, ProviderQuotaExhaustedError } from '@/lib/api/retry';

const CACHE_TTL_SECONDS = Number(process.env.FOOTBALL_CACHE_TTL_SECONDS ?? 24 * 60 * 60);

export async function cachedProviderFetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let cached: T | null = null;
  try {
    cached = await redis.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
  } catch (err) {
    logger.warn('football.cache.readFailed', { key, error: err instanceof Error ? err.message : String(err) });
  }

  try {
    const fresh = await loader();
    try {
      await redis.set(key, fresh, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      logger.warn('football.cache.writeFailed', { key, error: err instanceof Error ? err.message : String(err) });
    }
    return fresh;
  } catch (err) {
    // Entitlement exhaustion must not be masked by stale cache: doing so would
    // make an exhausted provider look healthy and hide the failure from the run.
    if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
    if (cached !== null && cached !== undefined) {
      logger.warn('football.cache.staleFallback', { key, error: err instanceof Error ? err.message : String(err) });
      return cached;
    }
    throw err;
  }
}
