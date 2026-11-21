import { redis } from '@/lib/redis';

const CACHE_TTL_SECONDS = Number(process.env.FOOTBALL_CACHE_TTL_SECONDS ?? 24 * 60 * 60);

export async function cachedProviderFetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  let cached: T | null = null;
  try {
    cached = await redis.get<T>(key);
    if (cached !== null && cached !== undefined) return cached;
  } catch (err) {
    console.warn('Football cache read failed', err);
  }

  try {
    const fresh = await loader();
    try {
      await redis.set(key, fresh, { ex: CACHE_TTL_SECONDS });
    } catch (err) {
      console.warn('Football cache write failed', err);
    }
    return fresh;
  } catch (err) {
    if (cached !== null && cached !== undefined) {
      console.warn('Football provider failed, using cached value', err);
      return cached;
    }
    throw err;
  }
}
