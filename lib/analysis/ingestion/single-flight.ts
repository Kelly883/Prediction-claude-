/**
 * Distributed single-flight protection (Phase 1 — Stage 5).
 *
 * The provider cache used a naive `get -> loader -> set` pattern: on a cold key,
 * N concurrent workers each miss and each issue the *same* provider request.
 * This module serialises those misses through a distributed lock so only the
 * lock owner performs the load; the others wait (bounded) and read the result
 * the owner cached.
 *
 * Guarantees:
 *   - Only a lock owner calls the loader for a given key.
 *   - A lock is released with a compare-and-delete keyed by a unique owner
 *     token, so an expired/re-acquired lock can never be deleted by a previous
 *     owner, and no permanent lock is left behind.
 *   - Waiters are bounded: they poll the cache and give up with a clear error
 *     (they are never handed a fabricated value). If the owner fails, the next
 *     waiter can take over on a later cycle — a natural retry opportunity.
 *   - If Redis is unavailable for locking we do NOT single-flight; we run the
 *     loader directly. The global provider rate limiter still bounds traffic.
 */
import { randomUUID } from 'node:crypto';
import { logger } from '@/lib/logger';

/** Minimal Redis surface used by single-flight (satisfied by @upstash/redis). */
export interface RedisLikeClient {
  get<T = unknown>(key: string): Promise<T | null>;
  set(key: string, value: unknown, opts?: { nx?: boolean; ex?: number }): Promise<unknown>;
  eval(script: string, keys: string[], args: Array<string | number>): Promise<unknown>;
}

/** Compare-and-delete: only the lock owner (matching token) releases it. */
export const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Raised when a waiter cannot obtain a result within the bounded wait. */
export class SingleFlightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SingleFlightError';
  }
}

export interface SingleFlightOptions<T> {
  client: RedisLikeClient;
  key: string;
  loader: () => Promise<T>;
  /** TTL (seconds) applied to the cached value. */
  ttlSeconds: number;
  /** Lock TTL (seconds). Must exceed normal loader latency. */
  lockTtlSeconds: number;
  /** Total bounded wait (ms) for non-owner workers. */
  waitMs: number;
  /** Poll interval (ms) while waiting for the owner's result. */
  pollMs: number;
  /** Cacheability predicate; defaults to "not null/undefined". */
  isCacheable?: (value: T) => boolean;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  makeToken?: () => string;
  onHit?: () => void;
  onMiss?: () => void;
  onReadFailure?: () => void;
  onWriteFailure?: () => void;
  onLockAcquired?: (waitedMs: number) => void;
  onContention?: () => void;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function safeRead<T>(client: RedisLikeClient, key: string, onFailure?: () => void): Promise<T | null> {
  try {
    const value = await client.get<T>(key);
    return value === undefined ? null : value;
  } catch (err) {
    logger.warn('football.cache.readFailed', { key, error: errMsg(err) });
    onFailure?.();
    return null;
  }
}

async function safeWrite<T>(
  client: RedisLikeClient,
  key: string,
  value: T,
  ttlSeconds: number,
  onFailure?: () => void,
): Promise<void> {
  try {
    await client.set(key, value, { ex: ttlSeconds });
  } catch (err) {
    logger.warn('football.cache.writeFailed', { key, error: errMsg(err) });
    onFailure?.();
  }
}

/** Release a lock only if we still own it (compare-and-delete). */
export async function releaseLockSafely(client: RedisLikeClient, lockKey: string, token: string): Promise<void> {
  try {
    await client.eval(RELEASE_LOCK_LUA, [lockKey], [token]);
  } catch (err) {
    logger.warn('football.cache.lockReleaseFailed', { key: lockKey, error: errMsg(err) });
  }
}

/**
 * Run `loader` at most once across concurrent workers for `key`, caching the
 * result and sharing it with any waiters.
 */
export async function runSingleFlight<T>(opts: SingleFlightOptions<T>): Promise<T> {
  const { client, key, loader } = opts;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? defaultSleep;
  const makeToken = opts.makeToken ?? (() => randomUUID());
  const lockKey = `${key}:__lock`;
  const start = now();

  const cached = await safeRead<T>(client, key, opts.onReadFailure);
  if (cached !== null) {
    opts.onHit?.();
    return cached;
  }
  opts.onMiss?.();

  const deadline = start + opts.waitMs;
  const isCacheable = opts.isCacheable ?? ((value: T) => value !== null && value !== undefined);

  // Try to become the single-flight owner. If another worker owns the lock we
  // wait (bounded) and re-check the cache so we return the owner's result.
  for (;;) {
    const token = makeToken();
    let acquired = false;
    try {
      const result = await client.set(lockKey, token, { nx: true, ex: opts.lockTtlSeconds });
      acquired = result === 'OK';
    } catch (err) {
      // Redis unavailable for locking: do NOT single-flight and leave no lock
      // behind. Run the loader directly — the global rate limiter still applies.
      logger.warn('football.cache.lockUnavailable', { key, error: errMsg(err) });
      return loader();
    }

    if (acquired) {
      const waited = now() - start;
      if (waited > 0) opts.onLockAcquired?.(waited);
      try {
        const value = await loader();
        if (isCacheable(value)) await safeWrite(client, key, value, opts.ttlSeconds, opts.onWriteFailure);
        return value;
      } finally {
        // Always release our own lock, even if the loader threw.
        await releaseLockSafely(client, lockKey, token);
      }
    }

    // Lock is held by another worker.
    if (now() >= deadline) {
      throw new SingleFlightError(`single-flight wait exceeded ${opts.waitMs}ms for key "${key}"`);
    }
    opts.onContention?.();
    await sleep(opts.pollMs);
    const found = await safeRead<T>(client, key, opts.onReadFailure);
    if (found !== null) {
      opts.onHit?.();
      return found;
    }
  }
}
