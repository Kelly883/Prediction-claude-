/**
 * Provider response cache (Phase 1 — Stage 5/6).
 *
 * Wraps distributed single-flight protection around the previous naive
 * `get -> loader -> set` behaviour so concurrent cache misses never issue
 * duplicate provider calls, and applies endpoint-specific TTLs so fast-moving
 * data (odds, fixtures) does not live for a full 24h while slow-moving data
 * (team statistics) does.
 *
 * Failure handling:
 *   - Read/write failures are logged and counted; a read failure degrades to a
 *     cache miss (never a fabricated hit).
 *   - Provider entitlement failures (auth/quota) propagate and are NEVER cached,
 *     so an exhausted provider can never look healthy.
 *   - `null`/`undefined` results are never cached.
 */
import { redis } from '@/lib/redis';
import { getProviderConfig, type ProviderConfig } from '@/lib/api/provider-config';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { runSingleFlight } from './single-flight';

/**
 * Choose a TTL for a cache key. Each rule is documented in
 * docs/PREDICTPRO_PROVIDER_PROTECTION.md ("Cache TTL decisions").
 */
export function resolveCacheTtlSeconds(key: string, cfg: ProviderConfig = getProviderConfig()): number {
  if (key.startsWith('weather:')) return cfg.cacheTtlWeatherSeconds;
  if (key.includes(':odds')) return cfg.cacheTtlOddsSeconds;
  if (key.includes(':injuries')) return cfg.cacheTtlInjuriesSeconds;
  if (key.includes(':h2h')) return cfg.cacheTtlH2hSeconds;
  if (key.includes(':team-stats') || key.includes(':standings')) return cfg.cacheTtlTeamStatsSeconds;
  if (key.includes(':scorers')) return cfg.cacheTtlScorersSeconds;
  if (key.includes(':fixtures')) return cfg.cacheTtlFixturesSeconds;
  return cfg.cacheTtlDefaultSeconds;
}

export async function cachedProviderFetch<T>(key: string, loader: () => Promise<T>): Promise<T> {
  const cfg = getProviderConfig();
  return runSingleFlight<T>({
    client: redis,
    key,
    loader,
    ttlSeconds: resolveCacheTtlSeconds(key, cfg),
    lockTtlSeconds: Math.max(1, Math.ceil(cfg.singleFlightLockTtlMs / 1000)),
    waitMs: cfg.singleFlightWaitMs,
    pollMs: cfg.singleFlightPollMs,
    onHit: () => void incrProviderMetric('cache:hit'),
    onMiss: () => void incrProviderMetric('cache:miss'),
    onReadFailure: () => void incrProviderMetric('cache:readFailure'),
    onWriteFailure: () => void incrProviderMetric('cache:writeFailure'),
    onLockAcquired: () => void incrProviderMetric('singleFlight:lockAcquired'),
    onContention: () => void incrProviderMetric('singleFlight:contended'),
  });
}
