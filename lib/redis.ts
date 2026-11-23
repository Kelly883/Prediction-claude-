import { Redis } from '@upstash/redis';

/**
 * Redis access layer.
 *
 * In production a *real*, distributed Redis (Upstash) is mandatory: the
 * in-memory fallback is per-instance and therefore cannot provide distributed
 * locking (cron de-duplication) or a shared analysis cache across serverless
 * instances. When misconfigured in production we fail closed instead of
 * silently degrading. In development/test the in-memory store is used.
 */

interface MemoryEntry {
  value: unknown;
  expiresAt: number | null;
}

const inMemoryStore = new Map<string, MemoryEntry>();

function readMemory<T>(key: string): T | null {
  const entry = inMemoryStore.get(key);
  if (!entry) return null;
  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    inMemoryStore.delete(key);
    return null;
  }
  return entry.value as T;
}

export function isDistributedRedisConfigured(): boolean {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function createInMemoryRedis() {
  return {
    get: async <T = any>(k: string): Promise<T | null> => readMemory<T>(k),
    // Honors SET NX semantics used by the analysis lock and lib/refresh-jti.ts
    // claim-on-consume: when nx is set and the key already exists, return null
    // (claim failed) instead of blindly overwriting.
    set: async (k: string, v: any, opts?: { nx?: boolean; ex?: number }) => {
      if (opts?.nx && readMemory(k) !== null) return null;
      inMemoryStore.set(k, {
        value: v,
        expiresAt: opts?.ex ? Date.now() + opts.ex * 1000 : null,
      });
      return 'OK';
    },
    del: async (k: string) => {
      const existed = inMemoryStore.delete(k);
      return existed ? 1 : 0;
    },
    incr: async (k: string) => {
      const current = Number(readMemory(k) ?? 0) + 1;
      const existing = inMemoryStore.get(k);
      inMemoryStore.set(k, { value: current, expiresAt: existing?.expiresAt ?? null });
      return current;
    },
    expire: async (k: string, seconds: number) => {
      const entry = inMemoryStore.get(k);
      if (!entry) return 0;
      entry.expiresAt = Date.now() + seconds * 1000;
      return 1;
    },
    sadd: async () => 1,
    smembers: async () => [],
    eval: async () => [1, 0],
    evalsha: async () => [1, 0],
  };
}

function createRedisClient(): unknown {
  // Tests never use a real Upstash connection: always use the in-memory store
  // regardless of whether Upstash credentials are present in the environment.
  if (process.env.NODE_ENV === 'test') {
    return createInMemoryRedis();
  }

  if (isDistributedRedisConfigured()) {
    try {
      return new Redis({
        url: process.env.UPSTASH_REDIS_REST_URL as string,
        token: process.env.UPSTASH_REDIS_REST_TOKEN as string,
      });
    } catch (err) {
      if (process.env.NODE_ENV === 'production') {
        throw new Error(`Failed to initialise Upstash Redis client: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'Distributed Redis is required in production but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are not set. ' +
        'The in-memory fallback cannot provide distributed locking or a shared cache and is disabled in production.',
    );
  }

  return createInMemoryRedis();
}

// Lazy singleton: the client is created on first use, never at import time. This
// keeps `next build` (which imports route modules) from failing when production
// Redis env vars are absent during the build step while still failing closed at
// runtime in production.
let client: any;

function getClient(): any {
  if (!client) client = createRedisClient();
  return client;
}

export const redis = new Proxy({} as Redis, {
  get(_target, property) {
    const instance = getClient();
    const value = instance[property];
    return typeof value === 'function' ? value.bind(instance) : value;
  },
});
