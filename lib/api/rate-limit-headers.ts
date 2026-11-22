/**
 * API-Football rate-limit response-header capture (Phase 1 — Stage 3, hardened).
 *
 * API-Football documents TWO independent measurement windows in response
 * headers (see docs for the documentation-verified names). They must NEVER be
 * mixed:
 *
 *   DAILY window (daily quota consumption):
 *     - `x-ratelimit-requests-limit`     → daily allocation
 *     - `x-ratelimit-requests-remaining` → daily remaining
 *
 *   PER-MINUTE window (short-term rate throttle):
 *     - `X-RateLimit-Limit`     → per-minute ceiling
 *     - `X-RateLimit-Remaining` → per-minute remaining
 *
 * A per-minute header must never be used to compute daily consumption, and a
 * missing header is never treated as zero. Only headers that actually carry a
 * verified numeric value are stored.
 *
 * This is a leaf module (imports only redis + logger) to avoid a circular
 * dependency between the low-level request layer and the quota service.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';

const HEADERS_KEY = 'provider:quota:api-football:headers';
const HEADER_TTL_SECONDS = 86_400;

/** Documented API-Football rate-limit header names (case-insensitive lookup). */
export const API_FOOTBALL_RATE_LIMIT_HEADERS = [
  'x-ratelimit-requests-limit',
  'x-ratelimit-requests-remaining',
  'X-RateLimit-Limit',
  'X-RateLimit-Remaining',
] as const;

/** DAILY quota window header names (lower-cased). */
export const DAILY_LIMIT_HEADER = 'x-ratelimit-requests-limit';
export const DAILY_REMAINING_HEADER = 'x-ratelimit-requests-remaining';
/** PER-MINUTE rate window header names (lower-cased). */
export const PER_MINUTE_LIMIT_HEADER = 'x-ratelimit-limit';
export const PER_MINUTE_REMAINING_HEADER = 'x-ratelimit-remaining';

/**
 * Latest observed rate-limit headers, with the two windows kept strictly
 * separate. `limit`/`remaining` are the DAILY pair (names retained for
 * backward compatibility); `perMinute*` are the per-minute pair.
 */
export interface StoredRateLimitHeaders {
  /** DAILY allocation (`x-ratelimit-requests-limit`). */
  limit: number | null;
  /** DAILY remaining (`x-ratelimit-requests-remaining`). */
  remaining: number | null;
  /** PER-MINUTE ceiling (`X-RateLimit-Limit`) — never used for daily quota. */
  perMinuteLimit: number | null;
  /** PER-MINUTE remaining (`X-RateLimit-Remaining`) — never used for daily quota. */
  perMinuteRemaining: number | null;
  capturedAt: string;
}

/** Extract the documented rate-limit headers from a raw Response (lower-cased). */
export function captureRateLimitHeaders(response: Response): Record<string, string> {
  const out: Record<string, string> = {};
  const get = response.headers?.get?.bind(response.headers);
  if (!get) return out;
  for (const name of API_FOOTBALL_RATE_LIMIT_HEADERS) {
    const value = get(name);
    if (value !== null && value !== undefined && value !== '') out[name.toLowerCase()] = value;
  }
  return out;
}

function pickNumber(headers: Record<string, string>, name: string): number | null {
  const raw = headers[name];
  if (raw === undefined || raw === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/**
 * Persist the latest observed rate-limit headers, keeping the daily and
 * per-minute windows as separate fields. Best-effort; never throws.
 *
 * Merge rules (never fabricate, never degrade a valid snapshot):
 *  - Only fields with a verified numeric value are written.
 *  - An incoming capture that is OLDER than the stored capture is ignored
 *    entirely, so an out-of-order response cannot overwrite newer data.
 *  - A window that is absent from the incoming capture keeps its stored value.
 *  - If both windows are absent, nothing is written (no overwrite with nulls).
 */
export async function storeRateLimitHeaders(headers: Record<string, string>, now: Date = new Date()): Promise<void> {
  const incomingDailyLimit = pickNumber(headers, DAILY_LIMIT_HEADER);
  const incomingDailyRemaining = pickNumber(headers, DAILY_REMAINING_HEADER);
  const incomingPerMinuteLimit = pickNumber(headers, PER_MINUTE_LIMIT_HEADER);
  const incomingPerMinuteRemaining = pickNumber(headers, PER_MINUTE_REMAINING_HEADER);

  const hasIncoming =
    incomingDailyLimit !== null ||
    incomingDailyRemaining !== null ||
    incomingPerMinuteLimit !== null ||
    incomingPerMinuteRemaining !== null;
  // Nothing verified to store: do not overwrite a previous value with nulls.
  if (!hasIncoming) return;

  let existing: StoredRateLimitHeaders | null = null;
  try {
    existing = await redis.get<StoredRateLimitHeaders>(HEADERS_KEY);
  } catch {
    existing = null;
  }

  const incomingMs = now.getTime();
  if (existing) {
    const existingMs = Date.parse(existing.capturedAt);
    // An older capture must never overwrite a newer one.
    if (Number.isFinite(existingMs) && existingMs > incomingMs) {
      logger.warn('provider.quota.headerStoreSkipped', { reason: 'stale-capture' });
      return;
    }
  }

  const merged: StoredRateLimitHeaders = {
    limit: incomingDailyLimit ?? existing?.limit ?? null,
    remaining: incomingDailyRemaining ?? existing?.remaining ?? null,
    perMinuteLimit: incomingPerMinuteLimit ?? existing?.perMinuteLimit ?? null,
    perMinuteRemaining: incomingPerMinuteRemaining ?? existing?.perMinuteRemaining ?? null,
    capturedAt: now.toISOString(),
  };

  try {
    await redis.set(HEADERS_KEY, merged, { ex: HEADER_TTL_SECONDS });
  } catch (err) {
    logger.warn('provider.quota.headerStoreFailed', { error: err instanceof Error ? err.message : String(err) });
  }
}

/** Latest captured rate-limit headers, or null when none/unknown. */
export async function getStoredRateLimitHeaders(): Promise<StoredRateLimitHeaders | null> {
  try {
    return await redis.get<StoredRateLimitHeaders>(HEADERS_KEY);
  } catch {
    return null;
  }
}
