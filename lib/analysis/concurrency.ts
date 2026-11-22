/**
 * In-process concurrency limiter (counting semaphore) used to bound the number
 * of simultaneous in-flight requests to an external provider.
 *
 * Enrichment fans out per-fixture (e.g. 6 parallel requests per fixture across
 * up to 10 fixtures = 60 concurrent calls). Without a bound, a free-tier
 * provider is instantly rate-limited (429) and the circuit breaker trips. This
 * limiter caps concurrent provider calls so the pipeline degrades gracefully
 * instead of stampeding.
 *
 * Correctness notes:
 *  - `available` is the number of free permits; it never goes negative.
 *  - Acquisition is synchronous and atomic (single-threaded), so a newly
 *    arriving caller cannot bypass waiters and over-subscribe.
 *  - On completion a permit is returned and handed directly to the next waiter
 *    (FIFO) without an interleaving window that could exceed the limit.
 */
export interface ConcurrencyLimiter {
  run<T>(fn: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly max: number;
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
  if (!Number.isFinite(max) || max < 1) {
    throw new Error(`Concurrency limit must be a positive number, got ${max}`);
  }
  let available = max;
  let active = 0;
  const queue: Array<() => void> = [];

  const run = <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const release = () => {
        active -= 1;
        available += 1;
        const next = queue.shift();
        if (next) next();
      };

      const execute = () => {
        // Release the permit BEFORE settling the caller's promise so that once
        // `await run(...)` returns, `active` already reflects the freed slot.
        Promise.resolve()
          .then(fn)
          .then(
            (value) => {
              release();
              resolve(value);
            },
            (err) => {
              release();
              reject(err);
            },
          );
      };

      const acquire = () => {
        if (available > 0) {
          available -= 1;
          active += 1;
          execute();
        } else {
          queue.push(acquire);
        }
      };

      acquire();
    });

  return {
    run,
    get active() {
      return active;
    },
    get max() {
      return max;
    },
  };
}