/**
 * Provider-protection metrics (Phase 1 — Stage 6/8 observability).
 *
 * Lightweight, day-scoped counters stored in Redis (shared across serverless
 * instances) so the monitoring endpoint can report cache effectiveness,
 * single-flight contention and provider request volume without a separate
 * metrics backend. Every write is best-effort: metrics must never fail the
 * request path.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const METRIC_TTL_SECONDS = 7 * 86_400;

export type ProviderMetricName =
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:readFailure'
  | 'cache:writeFailure'
  | 'singleFlight:lockAcquired'
  | 'singleFlight:contended'
  | 'provider:requests'
  | 'provider:rateLimitWait';

function dayPart(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function metricKey(name: string, now: Date): string {
  return `provider:metrics:${dayPart(now)}:${name}`;
}

/** Increment a day-scoped counter by one. Never throws. */
export async function incrProviderMetric(name: ProviderMetricName, now: Date = new Date()): Promise<void> {
  try {
    const key = metricKey(name, now);
    const value = await redis.incr(key);
    if (value === 1) await redis.expire(key, METRIC_TTL_SECONDS);
  } catch (err) {
    logger.warn('provider.metrics.incrFailed', { name, error: err instanceof Error ? err.message : String(err) });
  }
}

export interface ProviderMetricsSnapshot {
  day: string;
  cacheHits: number;
  cacheMisses: number;
  cacheReadFailures: number;
  cacheWriteFailures: number;
  singleFlightLockAcquisitions: number;
  singleFlightContention: number;
  providerRequests: number;
  rateLimitWaits: number;
}

/** Read today's counters. Missing/unreadable counters are reported as 0. */
export async function readProviderMetrics(now: Date = new Date()): Promise<ProviderMetricsSnapshot> {
  const read = async (name: string): Promise<number> => {
    try {
      return Number(await redis.get(metricKey(name, now))) || 0;
    } catch {
      return 0;
    }
  };
  return {
    day: dayPart(now),
    cacheHits: await read('cache:hit'),
    cacheMisses: await read('cache:miss'),
    cacheReadFailures: await read('cache:readFailure'),
    cacheWriteFailures: await read('cache:writeFailure'),
    singleFlightLockAcquisitions: await read('singleFlight:lockAcquired'),
    singleFlightContention: await read('singleFlight:contended'),
    providerRequests: await read('provider:requests'),
    rateLimitWaits: await read('provider:rateLimitWait'),
  };
}
