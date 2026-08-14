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
  };
}

export const redis = createRedisClient() as unknown as Redis;


