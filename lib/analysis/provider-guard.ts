import { createConcurrencyLimiter } from './concurrency';
import { QuotaExceededError, reserveQuota } from './quota';

/**
 * Composes the per-provider protections into a single guard that wraps an
 * actual provider request:
 *   1. Concurrency limit — at most `maxConcurrency` in-flight requests to this
 *      provider at once (prevents 429 stampedes during enrichment fan-out).
 *   2. Quota reservation — atomically checks/consumes the provider's request
 *      quota; throws QuotaExceededError (which callers treat as "skip this
 *      provider") before hitting the network once the cap is reached.
 *
 * The guard is provider-scoped: create one per provider module and reuse it for
 * every request in that process.
 */
export function createProviderGuard(label: string, maxConcurrency: number) {
  const limiter = createConcurrencyLimiter(maxConcurrency);
  return async function guarded<T>(fn: () => Promise<T>): Promise<T> {
    return limiter.run(async () => {
      const quota = await reserveQuota(label);
      if (!quota.allowed) {
        throw new QuotaExceededError(label, quota.used, quota.limit);
      }
      return fn();
    });
  };
}

/** Parses a positive integer from an env var, falling back on missing/invalid. */
export function positiveIntEnv(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}