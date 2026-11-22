/**
 * Provider-protection configuration (Phase 1 — Provider Protection).
 *
 * All limits/thresholds are read from validated server-side environment
 * variables so they can be tuned without a code change. Nothing here is a claim
 * about the provider's official entitlement: the provider only publishes
 * per-*plan* rate examples (e.g. Pro = 300/min or 5/s). Our values are INTERNAL
 * SAFETY LIMITS, intentionally more conservative than any paid tier, so that a
 * burst across concurrent serverless workers cannot exhaust the account.
 *
 * Every field is parsed independently with `.catch(default)`: a single malformed
 * or empty value can never crash the runtime or silently drop the other (valid)
 * settings — the bad field alone falls back to its conservative default.
 *
 * See docs/PREDICTPRO_PROVIDER_PROTECTION.md for the full rationale and the
 * distinction between provider-documented limits and internal safety limits.
 */
import { z } from 'zod';

/** Positive-integer field that falls back to `fallback` on any parse error. */
function intField(fallback: number, min = 1) {
  return z.coerce.number().int().min(min).default(fallback).catch(fallback);
}

/** 0..1 ratio field that falls back to `fallback` on any parse error. */
function ratioField(fallback: number) {
  return z.coerce.number().gt(0).lte(1).default(fallback).catch(fallback);
}

const ProviderConfigSchema = z.object({
  // --- Global distributed API-Football rate limiter (internal safety limits) ---
  /** Requests permitted per second across ALL workers (internal safety limit). */
  apiFootballRps: intField(4),
  /** Requests permitted per minute across ALL workers (internal safety limit). */
  apiFootballRpm: intField(240),
  /** Maximum time a caller will wait for a rate-limit slot before failing closed. */
  apiFootballMaxWaitMs: intField(10_000),
  /** Maximum single sleep between re-checks while waiting for a slot. */
  apiFootballMaxSleepMs: intField(1_000),

  // --- Independent Football-Data.org limiter (internal safety limits).
  // Defaults are pinned to the DOCUMENTED FREE-PLAN CEILING (10 requests/min)
  // because the account's paid entitlement is NOT verified. Never raise these on
  // an assumption about plan capacity — only via validated env after an
  // authorized live probe confirms the entitlement.
  /** Requests permitted per second across ALL workers (internal safety limit). */
  footballDataRps: intField(1),
  /** Requests permitted per minute across ALL workers (documented free-tier ceiling). */
  footballDataRpm: intField(10),
  /** Maximum time a caller will wait for a rate-limit slot before failing closed. */
  footballDataMaxWaitMs: intField(10_000),
  /** Maximum single sleep between re-checks while waiting for a slot. */
  footballDataMaxSleepMs: intField(1_000),

  // --- Execution-time budget guard for the daily analysis run ---
  /** Wall-clock ceiling for a single analysis invocation before it checkpoints
   *  and defers the remainder to the next invocation (see lib/analysis/ingestion/budget.ts). */
  analysisMaxRuntimeMs: intField(240_000),
  /** Fixtures processed per durable, idempotent ingestion batch. */
  analysisBatchSize: intField(25),

  // --- Daily quota monitoring thresholds ---
  quotaWarningThreshold: ratioField(0.7),
  quotaCriticalThreshold: ratioField(0.85),
  quotaStopThreshold: ratioField(0.95),
  /** How long a quota snapshot is considered fresh before it becomes STALE. */
  quotaFreshnessSeconds: intField(1_800),
  /** TTL applied to the stored quota snapshot in Redis. */
  quotaSnapshotTtlSeconds: intField(86_400),
  /** Behaviour when quota cannot be determined (missing/stale): 'block' | 'warn'. */
  quotaUnknownPolicy: z.enum(['block', 'warn']).default('block').catch('block'),

  // --- Enrichment concurrency ---
  enrichmentConcurrency: z.coerce.number().int().min(1).max(20).default(10).catch(10),

  // --- Distributed single-flight cache locks ---
  singleFlightLockTtlMs: intField(15_000),
  /** Bounded wait for a non-owner worker; must exceed the lock TTL. */
  singleFlightWaitMs: intField(18_000),
  singleFlightPollMs: intField(150),

  // --- Endpoint-specific cache TTLs (seconds) ---
  /** Default TTL for keys with no specific rule (slow-moving enrichment). */
  cacheTtlDefaultSeconds: intField(86_400),
  /** Fixtures: kickoff/status change; short-lived. */
  cacheTtlFixturesSeconds: intField(7_200),
  /** Team statistics / standings: change slowly. */
  cacheTtlTeamStatsSeconds: intField(86_400),
  /** Head-to-head history: effectively static within a season. */
  cacheTtlH2hSeconds: intField(86_400),
  /** Injuries: change during the day but not minute-to-minute. */
  cacheTtlInjuriesSeconds: intField(21_600),
  /** Odds: move continuously; must stay fresh. */
  cacheTtlOddsSeconds: intField(900),
  /** Top scorers: change slowly. */
  cacheTtlScorersSeconds: intField(43_200),
  /** Weather forecast: short-lived. */
  cacheTtlWeatherSeconds: intField(3_600),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

/**
 * Map the documented provider-protection environment variables onto schema
 * fields. Explicit mapping (rather than parsing `process.env` directly) keeps
 * the variable names stable and self-documenting, and prevents a field from
 * silently reading an unrelated variable.
 */
export function providerConfigSource(env: NodeJS.ProcessEnv = process.env): Record<string, unknown> {
  return {
    apiFootballRps: env.PROVIDER_RPS,
    apiFootballRpm: env.PROVIDER_RPM,
    apiFootballMaxWaitMs: env.PROVIDER_MAX_WAIT_MS,
    apiFootballMaxSleepMs: env.PROVIDER_MAX_SLEEP_MS,

    footballDataRps: env.FOOTBALL_DATA_RPS,
    footballDataRpm: env.FOOTBALL_DATA_RPM,
    footballDataMaxWaitMs: env.FOOTBALL_DATA_MAX_WAIT_MS,
    footballDataMaxSleepMs: env.FOOTBALL_DATA_MAX_SLEEP_MS,

    analysisMaxRuntimeMs: env.PROVIDER_ANALYSIS_MAX_RUNTIME_MS,
    analysisBatchSize: env.PROVIDER_ANALYSIS_BATCH_SIZE,

    quotaWarningThreshold: env.PROVIDER_QUOTA_WARNING_THRESHOLD,
    quotaCriticalThreshold: env.PROVIDER_QUOTA_CRITICAL_THRESHOLD,
    quotaStopThreshold: env.PROVIDER_QUOTA_STOP_THRESHOLD,
    quotaFreshnessSeconds: env.PROVIDER_QUOTA_FRESHNESS_SECONDS,
    quotaSnapshotTtlSeconds: env.PROVIDER_QUOTA_SNAPSHOT_TTL_SECONDS,
    quotaUnknownPolicy: env.PROVIDER_QUOTA_UNKNOWN_POLICY,

    enrichmentConcurrency: env.PROVIDER_ENRICHMENT_CONCURRENCY,

    singleFlightLockTtlMs: env.PROVIDER_SINGLE_FLIGHT_LOCK_TTL_MS,
    singleFlightWaitMs: env.PROVIDER_SINGLE_FLIGHT_WAIT_MS,
    singleFlightPollMs: env.PROVIDER_SINGLE_FLIGHT_POLL_MS,

    cacheTtlDefaultSeconds: env.PROVIDER_CACHE_TTL_DEFAULT_SECONDS,
    cacheTtlFixturesSeconds: env.PROVIDER_CACHE_TTL_FIXTURES_SECONDS,
    cacheTtlTeamStatsSeconds: env.PROVIDER_CACHE_TTL_TEAM_STATS_SECONDS,
    cacheTtlH2hSeconds: env.PROVIDER_CACHE_TTL_H2H_SECONDS,
    cacheTtlInjuriesSeconds: env.PROVIDER_CACHE_TTL_INJURIES_SECONDS,
    cacheTtlOddsSeconds: env.PROVIDER_CACHE_TTL_ODDS_SECONDS,
    cacheTtlScorersSeconds: env.PROVIDER_CACHE_TTL_SCORERS_SECONDS,
    cacheTtlWeatherSeconds: env.PROVIDER_CACHE_TTL_WEATHER_SECONDS,
  };
}

/** Parse + validate provider-protection configuration from the environment. */
export function parseProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return ProviderConfigSchema.parse(providerConfigSource(env));
}

/**
 * Validated provider-protection configuration. Uses `safeParse` so a single
 * malformed value cannot crash the whole runtime: invalid values fall back to
 * their conservative defaults.
 */
export function getProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const result = ProviderConfigSchema.safeParse(providerConfigSource(env));
  if (result.success) return result.data;
  // Fall back to defaults for any invalid field (keeps ingestion protected).
  return ProviderConfigSchema.parse({});
}
