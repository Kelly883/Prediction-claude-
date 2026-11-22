/**
 * API-Football rate-limit response-header capture (Phase 1 — Stage 3).
 *
 * API-Football documents rate-limit information in response headers. We capture
 * exactly the documented names and store the latest observed values so quota
 * monitoring can use them when available. Only headers that actually carry a
 * verified numeric value are stored — we never invent a value or treat a missing
 * header as zero.
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

const LIMIT_HEADER_NAMES = ['x-ratelimit-requests-limit', 'x-ratelimit-limit'] as const;
const REMAINING_HEADER_NAMES = ['x-ratelimit-requests-remaining', 'x-ratelimit-remaining'] as const;

export interface StoredRateLimitHeaders {
  limit: number | null;
  remaining: number | null;
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

function pickNumber(headers: Record<string, string>, names: readonly string[]): number | null {
  for (const name of names) {
    const raw = headers[name];
    if (raw === undefined || raw === '') continue;
    const value = Number(raw);
    if (Number.isFinite(value)) return value;
  }
  return null;
}

/** Persist the latest observed rate-limit headers. Best-effort; never throws. */
export async function storeRateLimitHeaders(headers: Record<string, string>, now: Date = new Date()): Promise<void> {
  const limit = pickNumber(headers, LIMIT_HEADER_NAMES);
  const remaining = pickNumber(headers, REMAINING_HEADER_NAMES);
  // Nothing verified to store: do not overwrite a previous value with nulls.
  if (limit === null && remaining === null) return;
  try {
    await redis.set(HEADERS_KEY, { limit, remaining, capturedAt: now.toISOString() }, { ex: HEADER_TTL_SECONDS });
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
