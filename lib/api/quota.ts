/**
 * API-Football daily quota monitoring (Phase 1 — Provider Protection).
 *
 * The provider exposes quota via two VERIFIED sources (see docs):
 *   1. The `/status` endpoint: `response.requests.current` (consumed) and
 *      `response.requests.limit_day` (daily allocation). This call does not
 *      count against the daily quota.
 *   2. Response headers: `x-ratelimit-requests-limit` (daily allocation) and
 *      `x-ratelimit-requests-remaining` (daily remaining).
 *
 * We never assume an unavailable quota value is zero, and we never present stale
 * data as current: unavailable → `UNKNOWN`, aged → `STALE`. Consumption
 * thresholds (70% warn / 85% critical / 95% stop) are configurable.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { fetchApiFootballStatus, type ApiFootballProviderStatus } from '@/lib/api/football-api';
import { getStoredRateLimitHeaders } from '@/lib/api/rate-limit-headers';
import { getProviderConfig } from './provider-config';

export type QuotaStatus = 'OK' | 'STALE' | 'UNKNOWN';
export type QuotaLevel = 'ok' | 'warning' | 'critical' | 'stop' | 'unknown' | 'stale';
export type QuotaSource = 'status-endpoint' | 'headers' | 'unknown';

export interface ProviderQuotaSnapshot {
  provider: 'api-football';
  plan?: string;
  subscriptionEnd?: string | null;
  /** Daily allocation, or null when unavailable. */
  dailyLimit: number | null;
  /** Requests consumed today, or null when unavailable. */
  consumed: number | null;
  /** Requests remaining today, or null when unavailable. */
  remaining: number | null;
  /** ISO timestamp of the last successful check. */
  lastCheckedAt: string;
  status: QuotaStatus;
  source: QuotaSource;
}

export const QUOTA_KEY = 'provider:quota:api-football';

function toFiniteNumber(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** Build a snapshot from a verified `/status` response. Nothing is invented. */
export function buildQuotaSnapshot(status: ApiFootballProviderStatus, now: Date = new Date()): ProviderQuotaSnapshot {
  const headerLimit = toFiniteNumber(status.headers['x-ratelimit-requests-limit']);
  const headerRemaining = toFiniteNumber(status.headers['x-ratelimit-requests-remaining']);
  // A matched (limit, remaining) header pair yields consumption by arithmetic —
  // it is derived from verified provider fields, never invented.
  const headerConsumed = headerLimit !== null && headerRemaining !== null ? Math.max(0, headerLimit - headerRemaining) : null;

  const dailyLimit = status.requestsLimitDay ?? headerLimit ?? null;
  const consumed = status.requestsCurrent ?? headerConsumed ?? null;
  const remaining = headerRemaining ?? (dailyLimit !== null && consumed !== null ? Math.max(0, dailyLimit - consumed) : null);

  const hasBody = status.requestsLimitDay !== undefined || status.requestsCurrent !== undefined;
  const hasHeader = headerLimit !== null || headerRemaining !== null;
  const source: QuotaSource = hasBody ? 'status-endpoint' : hasHeader ? 'headers' : 'unknown';
  const statusLabel: QuotaStatus = dailyLimit !== null && consumed !== null ? 'OK' : 'UNKNOWN';

  return {
    provider: 'api-football',
    plan: status.plan,
    subscriptionEnd: status.subscriptionEnd ?? null,
    dailyLimit,
    consumed,
    remaining,
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
    consumed: null,
    remaining: null,
    lastCheckedAt: now.toISOString(),
    status: 'UNKNOWN',
    source: 'unknown',
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

/** Refresh the stored quota snapshot from the provider `/status` endpoint. */
export async function refreshProviderQuota(now: Date = new Date()): Promise<ProviderQuotaSnapshot> {
  const status = await fetchApiFootballStatus();
  const snapshot = buildQuotaSnapshot(status, now);
  try {
    await redis.set(QUOTA_KEY, snapshot, { ex: getProviderConfig().quotaSnapshotTtlSeconds });
  } catch (err) {
    logger.warn('provider.quota.storeFailed', { error: err instanceof Error ? err.message : String(err) });
  }
  logger.info('provider.quota.refreshed', {
    status: snapshot.status,
    dailyLimit: snapshot.dailyLimit,
    consumed: snapshot.consumed,
    remaining: snapshot.remaining,
    source: snapshot.source,
  });
  return snapshot;
}

/** Build a snapshot from captured rate-limit response headers (fallback). */
export async function headerQuotaSnapshot(now: Date = new Date()): Promise<ProviderQuotaSnapshot | null> {
  const headers = await getStoredRateLimitHeaders();
  if (!headers) return null;
  const dailyLimit = headers.limit;
  const remaining = headers.remaining;
  const consumed = dailyLimit !== null && remaining !== null ? Math.max(0, dailyLimit - remaining) : null;
  const checkedMs = Date.parse(headers.capturedAt);
  const stale = !Number.isFinite(checkedMs)
    || now.getTime() - checkedMs > getProviderConfig().quotaFreshnessSeconds * 1000;
  return {
    provider: 'api-football',
    dailyLimit,
    consumed,
    remaining,
    lastCheckedAt: headers.capturedAt,
    status: stale ? 'STALE' : dailyLimit !== null && consumed !== null ? 'OK' : 'UNKNOWN',
    source: 'headers',
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
  let stored: ProviderQuotaSnapshot | null = null;
  try {
    stored = await redis.get<ProviderQuotaSnapshot>(QUOTA_KEY);
  } catch (err) {
    logger.warn('provider.quota.readFailed', { error: err instanceof Error ? err.message : String(err) });
    return unknownQuotaSnapshot(now);
  }
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
