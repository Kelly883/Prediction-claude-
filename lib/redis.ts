import { Redis } from '@upstash/redis';

// In-memory fallback store
const inMemoryStore = new Map<string, any>();

function createRedisClient(): any {
  if (process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN) {
    try {
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL,
        token: process.env.UPSTASH_REDIS_REST_TOKEN,
      });
    } catch {
      // Fallback below
    }
  }

  // In-memory mock
  return {
    get: async <T = any>(k: string): Promise<T | null> => {
      const val = inMemoryStore.get(k);
      return (val as T) ?? null;
    },
    set: async (k: string, v: any, _opts?: any) => {
      inMemoryStore.set(k, v);
      return 'OK';
    },
    del: async (k: string) => {
      inMemoryStore.delete(k);
      return 1;
    },
    incr: async (k: string) => {
      const n = (inMemoryStore.get(k) || 0) + 1;
      inMemoryStore.set(k, n);
      return n;
    },
    sadd: async () => 1,
    smembers: async () => [],
    eval: async () => [1, 0],
    // @upstash/ratelimit's sliding-window algorithm calls evalsha (a cached
    // Lua script execution) directly rather than falling back to eval — an
    // in-memory mock missing this method throws "evalsha is not a
    // function" the moment any rate-limited route runs without real
    // Upstash configured (any local dev environment, or this test suite).
    // Matches eval's behavior: reports "not rate limited" rather than
    // implementing real sliding-window logic in-memory — acceptable for a
    // fallback whose job is "don't crash when Redis isn't configured,"
    // not "replicate Redis locally." Real rate limiting requires real
    // Upstash, in any environment, same as before.
    evalsha: async () => [1, 0],
  };
}

export const redis = createRedisClient() as unknown as Redis;


