/**
 * Provider-protection metrics (Phase 1 — Stage 6/8 observability, hardened).
 *
 * Lightweight, day-scoped counters stored in Redis (shared across serverless
 * instances) so the monitoring endpoint can report provider request volume,
 * cache effectiveness, single-flight contention, rate-limiter pressure and
 * ingestion outcomes without a separate metrics backend. Every write is
 * best-effort: metrics must never fail the request path.
 *
 * Providers are tracked SEPARATELY. API-Football counters are namespaced `af:*`
 * and Football-Data.org counters `fd:*`, so a change in one provider's traffic
 * can never be mistaken for the other's. A logical fetch operation (e.g. a cache
 * hit) is NEVER counted as an outbound provider request: only actual HTTP
 * attempts increment `af:httpRequests` / `fd:httpRequests`.
 *
 * No counter stores a secret: keys and fields are fixed literals, never derived
 * from an API key, authorization header or Redis credential.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const METRIC_TTL_SECONDS = 7 * 86_400;

export type ProviderMetricName =
  // --- Cache (provider-agnostic) ---
  | 'cache:hit'
  | 'cache:miss'
  | 'cache:readFailure'
  | 'cache:writeFailure'
  // --- Distributed single-flight ---
  | 'singleFlight:lockAcquired'
  | 'singleFlight:contended'
  | 'singleFlight:lockUnavailable'
  | 'singleFlight:waiterTimeout'
  | 'singleFlight:failed'
  // --- Legacy aliases (retained for backward compatibility; see docs) ---
  | 'provider:requests'
  | 'provider:rateLimitWait'
  // --- API-Football (af:*) ---
  | 'af:httpRequests'
  | 'af:success'
  | 'af:failed'
  | 'af:429'
  | 'af:authFailures'
  | 'af:quotaFailures'
  | 'af:rateLimitWait'
  | 'af:rateLimitDenied'
  | 'af:fallbackActivated'
  // --- Football-Data.org (fd:*) ---
  | 'fd:httpRequests'
  | 'fd:success'
  | 'fd:failed'
  | 'fd:429'
  | 'fd:authFailures'
  | 'fd:quotaFailures'
  | 'fd:rateLimitWait'
  | 'fd:rateLimitDenied'
  | 'fd:fallbackActivated'
  // --- Quota refresh + ingestion outcomes ---
  | 'quota:refreshSuccess'
  | 'quota:refreshFailure'
  | 'quota:refreshSkipped'
  | 'ingestion:completed'
  | 'ingestion:deferred'
  | 'ingestion:blocked'
  | 'ingestion:staleRecovered'
  | 'ingestion:exhausted';

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

/** Per-provider counter block, read for the monitoring endpoint. */
export interface ProviderCounters {
  /** Actual outbound HTTP attempts (NOT logical fetches, NOT cache hits). */
  httpRequests: number;
  success: number;
  failed: number;
  rateLimited429: number;
  authFailures: number;
  quotaFailures: number;
  rateLimitWaits: number;
  rateLimitDenied: number;
  fallbackActivated: number;
}

export interface ProviderMetricsSnapshot {
  day: string;
  // Cache + single-flight (provider-agnostic).
  cacheHits: number;
  cacheMisses: number;
  cacheReadFailures: number;
  cacheWriteFailures: number;
  singleFlightLockAcquisitions: number;
  singleFlightContention: number;
  singleFlightLockUnavailable: number;
  singleFlightWaiterTimeouts: number;
  singleFlightFailures: number;
  // Legacy aliases (see docs/PREDICTPRO_PROVIDER_PROTECTION.md).
  providerRequests: number;
  rateLimitWaits: number;
  // Provider-scoped counters.
  apiFootball: ProviderCounters;
  footballData: ProviderCounters;
  // Operational outcomes.
  quotaRefreshSuccess: number;
  quotaRefreshFailure: number;
  quotaRefreshSkipped: number;
  ingestionCompleted: number;
  ingestionDeferred: number;
  ingestionBlocked: number;
}

/** Missing/unreadable counters are reported as 0 (never fabricated non-zero). */
export async function readProviderMetrics(now: Date = new Date()): Promise<ProviderMetricsSnapshot> {
  const read = async (name: string): Promise<number> => {
    try {
      return Number(await redis.get(metricKey(name, now))) || 0;
    } catch {
      return 0;
    }
  };
  const counters = async (prefix: 'af' | 'fd'): Promise<ProviderCounters> => ({
    httpRequests: await read(`${prefix}:httpRequests`),
    success: await read(`${prefix}:success`),
    failed: await read(`${prefix}:failed`),
    rateLimited429: await read(`${prefix}:429`),
    authFailures: await read(`${prefix}:authFailures`),
    quotaFailures: await read(`${prefix}:quotaFailures`),
    rateLimitWaits: await read(`${prefix}:rateLimitWait`),
    rateLimitDenied: await read(`${prefix}:rateLimitDenied`),
    fallbackActivated: await read(`${prefix}:fallbackActivated`),
  });
  return {
    day: dayPart(now),
    cacheHits: await read('cache:hit'),
    cacheMisses: await read('cache:miss'),
    cacheReadFailures: await read('cache:readFailure'),
    cacheWriteFailures: await read('cache:writeFailure'),
    singleFlightLockAcquisitions: await read('singleFlight:lockAcquired'),
    singleFlightContention: await read('singleFlight:contended'),
    singleFlightLockUnavailable: await read('singleFlight:lockUnavailable'),
    singleFlightWaiterTimeouts: await read('singleFlight:waiterTimeout'),
    singleFlightFailures: await read('singleFlight:failed'),
    providerRequests: await read('provider:requests'),
    rateLimitWaits: await read('provider:rateLimitWait'),
    apiFootball: await counters('af'),
    footballData: await counters('fd'),
    quotaRefreshSuccess: await read('quota:refreshSuccess'),
    quotaRefreshFailure: await read('quota:refreshFailure'),
    quotaRefreshSkipped: await read('quota:refreshSkipped'),
    ingestionCompleted: await read('ingestion:completed'),
    ingestionDeferred: await read('ingestion:deferred'),
    ingestionBlocked: await read('ingestion:blocked'),
  };
}
