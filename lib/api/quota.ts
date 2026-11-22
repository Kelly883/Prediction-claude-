/**
 * API-Football daily quota monitoring (Phase 1 — Provider Protection, hardened).
 *
 * API-Football exposes quota via two VERIFIED sources (see docs):
 *   1. The `/status` endpoint: `response.requests.current` (consumed) and
 *      `response.requests.limit_day` (daily allocation). This call does not
 *      count against the daily quota.
 *   2. Response headers — but there are TWO INDEPENDENT WINDOWS and they must
 *      NEVER be mixed:
 *        DAILY window:      `x-ratelimit-requests-limit` / `...-remaining`
 *        PER-MINUTE window: `X-RateLimit-Limit` / `X-RateLimit-Remaining`
 *
 * Rules enforced here:
 *   - Daily quota is derived ONLY from the `/status` daily fields or the DAILY
 *     header pair. Per-minute headers are NEVER used to compute daily
 *     consumption.
 *   - Daily and per-minute measurements are stored as SEPARATE fields; values
 *     from different windows are never combined.
 *   - A missing value is NEVER interpreted as zero.
 *   - If the daily quota cannot be established, `status` stays `UNKNOWN`.
 *   - A valid snapshot is never overwritten with an incomplete or older one.
 *   - Each measurement records its source.
 *
 * We never present stale data as current: aged → `STALE`. Consumption
 * thresholds (70% warn / 85% critical / 95% stop) are configurable.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { fetchApiFootballStatus, type ApiFootballProviderStatus } from '@/lib/api/football-api';
import {
  getStoredRateLimitHeaders,
  DAILY_LIMIT_HEADER,
  DAILY_REMAINING_HEADER,
  PER_MINUTE_LIMIT_HEADER,
  PER_MINUTE_REMAINING_HEADER,
} from '@/lib/api/rate-limit-headers';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { getProviderConfig } from './provider-config';

export type QuotaStatus = 'OK' | 'STALE' | 'UNKNOWN';
export type QuotaLevel = 'ok' | 'warning' | 'critical' | 'stop' | 'unknown' | 'stale';

/**
 * Provenance of a single measured value. Every numeric field in the snapshot
 * carries the label of the exact place it was read from (or derived), so a
 * consumer can never confuse a documented `/status` figure with a per-minute
 * header, nor a measured value with an internally derived estimate:
 *
 *  - `PROVIDER_STATUS`         read directly from the `/status` body
 *                              (`response.requests.current` / `limit_day`).
 *  - `DAILY_RESPONSE_HEADERS`  read directly from the DAILY header pair
 *                              (`x-ratelimit-requests-limit` / `-remaining`).
 *  - `MINUTE_RATE_HEADERS`     read directly from the PER-MINUTE header pair
 *                              (`X-RateLimit-Limit` / `-Remaining`).
 *  - `INTERNAL_ESTIMATE`       derived from other verified values within the
 *                              SAME window (e.g. `limit_day − current`), never
 *                              invented and never crossing windows.
 *  - `UNKNOWN`                 no verified value available (never zero).
 */
export type QuotaSource =
  | 'PROVIDER_STATUS'
  | 'DAILY_RESPONSE_HEADERS'
  | 'MINUTE_RATE_HEADERS'
  | 'INTERNAL_ESTIMATE'
  | 'UNKNOWN';

export interface ProviderQuotaSnapshot {
  provider: 'api-football';
  plan?: string;
  subscriptionEnd?: string | null;
  // --- DAILY quota window (drives the ingestion gate) ---
  /** Daily allocation, or null when unavailable. */
  dailyLimit: number | null;
  /** Provenance of `dailyLimit`. */
  dailyLimitSource: QuotaSource;
  /** Requests consumed today, or null when unavailable. */
  consumed: number | null;
  /** Provenance of `consumed`. */
  consumedSource: QuotaSource;
  /** Requests remaining today, or null when unavailable. */
  remaining: number | null;
  /** Provenance of `remaining`. */
  remainingSource: QuotaSource;
  // --- PER-MINUTE rate window (observability only; never feeds daily quota) ---
  /** Per-minute request ceiling, or null when unavailable. */
  perMinuteLimit: number | null;
  /** Provenance of `perMinuteLimit`. */
  perMinuteLimitSource: QuotaSource;
  /** Per-minute requests remaining, or null when unavailable. */
  perMinuteRemaining: number | null;
  /** Provenance of `perMinuteRemaining`. */
  perMinuteRemainingSource: QuotaSource;
  /** ISO timestamp of the last successful check. */
  lastCheckedAt: string;
  status: QuotaStatus;
  /** Overall source that established the DAILY window. */
  source: QuotaSource;
}

export const QUOTA_KEY = 'provider:quota:api-football';

/** Redis key for tracking our own daily quota consumption per provider. */
function quotaConsumedKey(provider: 'api-football' | 'football-data'): string {
  return `provider:quota:consumed:${provider}`;
}

/**
 * Reserve one unit of daily quota for an actual outbound provider HTTP attempt.
 *
 * Increments our own consumption counter in Redis and checks it against the
 * configured daily limit. If the limit would be exceeded, throws
 * {@link ProviderQuotaExhaustedError} so the caller knows the attempt cannot
 * proceed. Each call consumes exactly one unit; retries re-reserve.
 *
 * Fails closed: if Redis is unavailable we cannot verify quota, so we refuse
 * the attempt rather than risk over-consumption.
 *
 * Returns the new consumed count after reservation.
 */
export async function reserveProviderQuota(
  provider: 'api-football' | 'football-data',
): Promise<number> {
  const cfg = getProviderConfig();
  const dailyLimit =
    provider === 'api-football' ? cfg.apiFootballDailyLimit : cfg.footballDataDailyLimit;

  // The daily limit is an internal safety cap derived from the configured
  // sustained rate. If no meaningful limit can be derived, allow the attempt
  // (the gate layer handles broader quota policy).
  if (!dailyLimit || dailyLimit <= 0) {
    try {
      await redis.incr(quotaConsumedKey(provider));
    } catch {
      // Redis unavailable — cannot track consumption; fail closed.
      throw new ProviderQuotaExhaustedError(
        provider,
        `Quota store unavailable for ${provider}`,
      );
    }
    return 1;
  }

  let consumed: number;
  try {
    consumed = await redis.incr(quotaConsumedKey(provider));
  } catch (err) {
    throw new ProviderQuotaExhaustedError(
      provider,
      `Quota store unavailable for ${provider}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (consumed > dailyLimit) {
    void incrProviderMetric(
      provider === 'api-football' ? 'af:quotaFailures' : 'fd:quotaFailures',
    );
    throw new ProviderQuotaExhaustedError(
      provider,
      `Daily quota exhausted for ${provider}: ${consumed}/${dailyLimit}`,
    );
  }

  return consumed;
}

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Build a snapshot from a verified `/status` response. Nothing is invented, the
 * daily and per-minute windows are kept strictly separate, and every value
 * records the source it came from.
 */
export function buildQuotaSnapshot(status: ApiFootballProviderStatus, now: Date = new Date()): ProviderQuotaSnapshot {
  // DAILY window headers.
  const dailyHeaderLimit = toFiniteNumber(status.headers[DAILY_LIMIT_HEADER]);
  const dailyHeaderRemaining = toFiniteNumber(status.headers[DAILY_REMAINING_HEADER]);
  // PER-MINUTE window headers (never used for daily figures).
  const perMinuteLimit = toFiniteNumber(status.headers[PER_MINUTE_LIMIT_HEADER]);
  const perMinuteRemaining = toFiniteNumber(status.headers[PER_MINUTE_REMAINING_HEADER]);

  // DAILY: pick ONE source and use it consistently for the whole daily window.
  // The `/status` daily fields take precedence; otherwise the DAILY header pair.
  // We never COMBINE the two sources for the same window — mixing a body value
  // with a header value would yield an internally inconsistent snapshot (e.g. a
  // `remaining` that contradicts `limit - consumed`).
  const bodyDailyLimit = toFiniteNumber(status.requestsLimitDay);
  const bodyConsumed = toFiniteNumber(status.requestsCurrent);
  const hasBodyDaily = bodyDailyLimit !== null || bodyConsumed !== null;
  const hasHeaderDaily = dailyHeaderLimit !== null || dailyHeaderRemaining !== null;

  let dailyLimit: number | null = null;
  let dailyLimitSource: QuotaSource = 'UNKNOWN';
  let consumed: number | null = null;
  let consumedSource: QuotaSource = 'UNKNOWN';
  let remaining: number | null = null;
  let remainingSource: QuotaSource = 'UNKNOWN';
  let source: QuotaSource = 'UNKNOWN';

  if (hasBodyDaily) {
    source = 'PROVIDER_STATUS';
    dailyLimit = bodyDailyLimit;
    dailyLimitSource = bodyDailyLimit !== null ? 'PROVIDER_STATUS' : 'UNKNOWN';
    consumed = bodyConsumed;
    consumedSource = bodyConsumed !== null ? 'PROVIDER_STATUS' : 'UNKNOWN';
    // `remaining` is DERIVED within the daily window → INTERNAL_ESTIMATE.
    if (dailyLimit !== null && consumed !== null) {
      remaining = Math.max(0, dailyLimit - consumed);
      remainingSource = 'INTERNAL_ESTIMATE';
    }
  } else if (hasHeaderDaily) {
    source = 'DAILY_RESPONSE_HEADERS';
    dailyLimit = dailyHeaderLimit;
    dailyLimitSource = dailyHeaderLimit !== null ? 'DAILY_RESPONSE_HEADERS' : 'UNKNOWN';
    remaining = dailyHeaderRemaining;
    remainingSource = dailyHeaderRemaining !== null ? 'DAILY_RESPONSE_HEADERS' : 'UNKNOWN';
    // `consumed` is DERIVED within the daily window → INTERNAL_ESTIMATE.
    if (dailyLimit !== null && remaining !== null) {
      consumed = Math.max(0, dailyLimit - remaining);
      consumedSource = 'INTERNAL_ESTIMATE';
    }
  }

  const perMinuteLimitSource: QuotaSource = perMinuteLimit !== null ? 'MINUTE_RATE_HEADERS' : 'UNKNOWN';
  const perMinuteRemainingSource: QuotaSource = perMinuteRemaining !== null ? 'MINUTE_RATE_HEADERS' : 'UNKNOWN';
  // Daily quota is "established" only when both the allocation and consumption
  // are known; otherwise it stays UNKNOWN (never zero).
  const statusLabel: QuotaStatus = dailyLimit !== null && consumed !== null ? 'OK' : 'UNKNOWN';

  return {
    provider: 'api-football',
    plan: status.plan,
    subscriptionEnd: status.subscriptionEnd ?? null,
    dailyLimit,
    dailyLimitSource,
    consumed,
    consumedSource,
    remaining,
    remainingSource,
    perMinuteLimit,
    perMinuteLimitSource,
    perMinuteRemaining,
    perMinuteRemainingSource,
    lastCheckedAt: now.toISOString(),
    status: statusLabel,
    source,
  };
}

/** A snapshot representing "we do not know". Never zero. */
export function unknownQuotaSnapshot(now: Date = new Date()): ProviderQuotaSnapshot {
  return {
    provider: 'api-football',
    dailyLimit: null,
    dailyLimitSource: 'UNKNOWN',
    consumed: null,
    consumedSource: 'UNKNOWN',
    remaining: null,
    remainingSource: 'UNKNOWN',
    perMinuteLimit: null,
    perMinuteLimitSource: 'UNKNOWN',
    perMinuteRemaining: null,
    perMinuteRemainingSource: 'UNKNOWN',
    lastCheckedAt: now.toISOString(),
    status: 'UNKNOWN',
    source: 'UNKNOWN',
  };
}

export interface QuotaAssessment {
  level: QuotaLevel;
  /** consumed / dailyLimit (0..1), or null when unavailable. */
  consumedRatio: number | null;
  reason: string;
}

/** Assess consumption against the configured 70/85/95 thresholds. */
export function assessQuota(snapshot: ProviderQuotaSnapshot): QuotaAssessment {
  const cfg = getProviderConfig();
  if (snapshot.status === 'STALE') {
    return { level: 'stale', consumedRatio: null, reason: 'Quota snapshot is stale — cannot confirm remaining capacity' };
  }
  if (snapshot.dailyLimit === null || snapshot.consumed === null || snapshot.dailyLimit <= 0) {
    return { level: 'unknown', consumedRatio: null, reason: 'Quota information unavailable' };
  }
  const ratio = snapshot.consumed / snapshot.dailyLimit;
  if (ratio >= cfg.quotaStopThreshold) {
    return { level: 'stop', consumedRatio: ratio, reason: `Daily quota ${(ratio * 100).toFixed(1)}% consumed (>= ${cfg.quotaStopThreshold * 100}%)` };
  }
  if (ratio >= cfg.quotaCriticalThreshold) {
    return { level: 'critical', consumedRatio: ratio, reason: `Daily quota ${(ratio * 100).toFixed(1)}% consumed (>= ${cfg.quotaCriticalThreshold * 100}%)` };
  }
  if (ratio >= cfg.quotaWarningThreshold) {
    return { level: 'warning', consumedRatio: ratio, reason: `Daily quota ${(ratio * 100).toFixed(1)}% consumed (>= ${cfg.quotaWarningThreshold * 100}%)` };
  }
  return { level: 'ok', consumedRatio: ratio, reason: `Daily quota ${(ratio * 100).toFixed(1)}% consumed` };
}

async function readStoredSnapshot(): Promise<ProviderQuotaSnapshot | null> {
  try {
    return await redis.get<ProviderQuotaSnapshot>(QUOTA_KEY);
  } catch (err) {
    logger.warn('provider.quota.readFailed', { error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

const REFRESH_LEASE_KEY = 'provider:quota:refresh:lease';

/**
 * Best-effort single-flight lease for quota refreshes. Returns true when this
 * invocation may proceed (acquired the lease, or Redis is unavailable so we
 * cannot dedupe), false when another refresh holds the lease.
 */
async function tryAcquireRefreshLease(ttlSeconds: number): Promise<boolean> {
  try {
    const result = await redis.set(REFRESH_LEASE_KEY, '1', { nx: true, ex: ttlSeconds });
    return result === 'OK';
  } catch (err) {
    logger.warn('provider.quota.leaseFailed', { error: err instanceof Error ? err.message : String(err) });
    return true; // cannot dedupe without Redis; do not block a refresh on it
  }
}

/**
 * Decide which snapshot to persist. A valid (established, newer-or-equal)
 * snapshot is never replaced by an incomplete (UNKNOWN) or older one — that
 * would silently discard a known-good quota reading.
 */
function snapshotToStore(existing: ProviderQuotaSnapshot | null, fresh: ProviderQuotaSnapshot): ProviderQuotaSnapshot | null {
  if (!existing) return fresh.status === 'UNKNOWN' ? null : fresh;
  const existingMs = Date.parse(existing.lastCheckedAt);
  const freshMs = Date.parse(fresh.lastCheckedAt);
  if (Number.isFinite(existingMs) && Number.isFinite(freshMs) && freshMs < existingMs) {
    return null; // older information must not overwrite newer
  }
  if (fresh.status === 'UNKNOWN' && existing.status !== 'UNKNOWN') {
    return null; // incomplete information must not overwrite a valid snapshot
  }
  return fresh;
}

/** Refresh the stored quota snapshot from the provider `/status` endpoint. */
export interface RefreshQuotaOptions {
  /**
   * When > 0, a short Redis lease prevents overlapping invocations from issuing
   * duplicate `/status` polls (e.g. the cron and a manual admin refresh, or two
   * overlapping cron ticks). A skipped refresh returns the stored snapshot
   * (read-only) and is counted as `quota:refreshSkipped` — never as success.
   */
  dedupeWindowSeconds?: number;
}

export async function refreshProviderQuota(
  now: Date = new Date(),
  options: RefreshQuotaOptions = {},
): Promise<ProviderQuotaSnapshot> {
  const dedupeSeconds = Math.max(0, options.dedupeWindowSeconds ?? 0);
  if (dedupeSeconds > 0) {
    const locked = await tryAcquireRefreshLease(dedupeSeconds);
    if (!locked) {
      logger.info('provider.quota.refreshSkipped', { reason: 'overlap' });
      await incrProviderMetric('quota:refreshSkipped');
      const stored = await readStoredSnapshot();
      return stored ?? unknownQuotaSnapshot(now);
    }
  }

  let status: ApiFootballProviderStatus;
  try {
    status = await fetchApiFootballStatus();
  } catch (err) {
    await incrProviderMetric('quota:refreshFailure');
    throw err;
  }
  const fresh = buildQuotaSnapshot(status, now);
  if (fresh.status === 'UNKNOWN') await incrProviderMetric('quota:refreshFailure');
  else await incrProviderMetric('quota:refreshSuccess');

  const existing = await readStoredSnapshot();
  const toStore = snapshotToStore(existing, fresh);
  if (toStore) {
    try {
      await redis.set(QUOTA_KEY, toStore, { ex: getProviderConfig().quotaSnapshotTtlSeconds });
    } catch (err) {
      logger.warn('provider.quota.storeFailed', { error: err instanceof Error ? err.message : String(err) });
    }
  } else {
    logger.warn('provider.quota.storeSkipped', { reason: 'incomplete-or-older', freshStatus: fresh.status });
  }
  logger.info('provider.quota.refreshed', {
    status: fresh.status,
    dailyLimit: fresh.dailyLimit,
    consumed: fresh.consumed,
    remaining: fresh.remaining,
    perMinuteLimit: fresh.perMinuteLimit,
    perMinuteRemaining: fresh.perMinuteRemaining,
    source: fresh.source,
    stored: Boolean(toStore),
  });
  return fresh;
}

/** Build a snapshot from captured DAILY rate-limit response headers (fallback). */
export async function headerQuotaSnapshot(now: Date = new Date()): Promise<ProviderQuotaSnapshot | null> {
  const headers = await getStoredRateLimitHeaders();
  if (!headers) return null;
  // DAILY window only. `limit`/`remaining` are the DAILY pair (see rate-limit-headers).
  const dailyLimit = headers.limit;
  const remaining = headers.remaining;
  const consumed = dailyLimit !== null && remaining !== null ? Math.max(0, dailyLimit - remaining) : null;
  const checkedMs = Date.parse(headers.capturedAt);
  const stale = !Number.isFinite(checkedMs)
    || now.getTime() - checkedMs > getProviderConfig().quotaFreshnessSeconds * 1000;
  return {
    provider: 'api-football',
    dailyLimit,
    dailyLimitSource: dailyLimit !== null ? 'DAILY_RESPONSE_HEADERS' : 'UNKNOWN',
    consumed,
    consumedSource: consumed !== null ? 'INTERNAL_ESTIMATE' : 'UNKNOWN',
    remaining,
    remainingSource: remaining !== null ? 'DAILY_RESPONSE_HEADERS' : 'UNKNOWN',
    perMinuteLimit: headers.perMinuteLimit,
    perMinuteLimitSource: headers.perMinuteLimit !== null ? 'MINUTE_RATE_HEADERS' : 'UNKNOWN',
    perMinuteRemaining: headers.perMinuteRemaining,
    perMinuteRemainingSource: headers.perMinuteRemaining !== null ? 'MINUTE_RATE_HEADERS' : 'UNKNOWN',
    lastCheckedAt: headers.capturedAt,
    status: stale ? 'STALE' : dailyLimit !== null && consumed !== null ? 'OK' : 'UNKNOWN',
    source: 'DAILY_RESPONSE_HEADERS',
  };
}

/**
 * Read the stored quota snapshot, marking it STALE when it is older than the
 * configured freshness window. Never returns a fabricated value.
 *
 * The gate is driven ONLY by the verified `/status` snapshot: the rate-limit
 * response headers are captured for observability but are NOT assumed to be a
 * daily-quota figure (see docs), so they never feed the ingestion gate.
 */
export async function getProviderQuota(now: Date = new Date()): Promise<ProviderQuotaSnapshot> {
  const stored = await readStoredSnapshot();
  if (!stored) return unknownQuotaSnapshot(now);

  if (stored.status === 'UNKNOWN') return stored;
  const ageMs = now.getTime() - Date.parse(stored.lastCheckedAt);
  const maxAgeMs = getProviderConfig().quotaFreshnessSeconds * 1000;
  if (!Number.isFinite(ageMs) || ageMs > maxAgeMs) {
    return { ...stored, status: 'STALE' };
  }
  return { ...stored, status: 'OK' };
}

export interface QuotaGateResult {
  allowed: boolean;
  level: QuotaLevel;
  reason: string;
  quota: ProviderQuotaSnapshot;
}

/**
 * Decide whether automated ingestion may proceed based on quota state.
 *
 *  - `stop` (>=95%)           → blocked.
 *  - `unknown`/`stale`        → blocked by default (conservative); `warn` policy
 *                               allows it but flags the reason.
 *  - `ok`/`warning`/`critical`→ allowed (warning/critical surfaced for admins).
 */
export async function evaluateQuotaGate(now: Date = new Date()): Promise<QuotaGateResult> {
  const quota = await getProviderQuota(now);
  const assessment = assessQuota(quota);

  if (assessment.level === 'stop') {
    return { allowed: false, level: 'stop', reason: assessment.reason, quota };
  }

  if (assessment.level === 'unknown' || assessment.level === 'stale') {
    const policy = getProviderConfig().quotaUnknownPolicy;
    const allowed = policy === 'warn';
    return {
      allowed,
      level: assessment.level,
      reason: `${assessment.reason}; quota-unknown policy=${policy} → ${allowed ? 'proceeding (flagged)' : 'blocked'}`,
      quota,
    };
  }

  return { allowed: true, level: assessment.level, reason: assessment.reason, quota };
}
