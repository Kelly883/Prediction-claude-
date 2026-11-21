/**
 * Bounded, provider-aware HTTP retry utilities.
 *
 * Providers (API-Football, Football-Data.org) enforce rate limits and daily
 * quotas. We must:
 *   - retry only *recoverable* failures (network errors, timeouts, 5xx, 429),
 *   - honour the server's `Retry-After` header on 429,
 *   - use exponential backoff with a hard cap,
 *   - never retry non-recoverable failures (auth, quota, bad request), and
 *   - surface quota/auth failures so ingestion cannot look successful when it
 *     did no work.
 */

export type ProviderName = 'api-football' | 'football-data';

/** Base class for all provider failures. `recoverable` drives retry decisions. */
export class ProviderError extends Error {
  readonly provider: ProviderName;
  readonly status?: number;
  readonly recoverable: boolean;

  constructor(
    message: string,
    options: { provider: ProviderName; status?: number; recoverable: boolean },
  ) {
    super(message);
    this.name = 'ProviderError';
    this.provider = options.provider;
    this.status = options.status;
    this.recoverable = options.recoverable;
  }
}

/** 429 / throttling. Recoverable, and carries the provider-requested delay. */
export class ProviderRateLimitError extends ProviderError {
  readonly retryAfterSeconds?: number;

  constructor(provider: ProviderName, message: string, retryAfterSeconds?: number) {
    super(message, { provider, status: 429, recoverable: true });
    this.name = 'ProviderRateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * The provider is configured but has exhausted its plan entitlement (daily
 * request quota, season subscription, expired key). Non-recoverable: retrying
 * cannot help, and callers must not treat this as an empty-but-successful run.
 */
export class ProviderQuotaExhaustedError extends ProviderError {
  constructor(provider: ProviderName, message: string, status = 429) {
    super(message, { provider, status, recoverable: false });
    this.name = 'ProviderQuotaExhaustedError';
  }
}

/** Authentication / authorisation failure (missing or invalid key). Non-recoverable. */
export class ProviderAuthError extends ProviderError {
  constructor(provider: ProviderName, status: number, message: string) {
    super(message, { provider, status, recoverable: false });
    this.name = 'ProviderAuthError';
  }
}

export interface RetryOptions {
  /** Additional attempts after the first. Clamped to [0, 5]. */
  retries?: number;
  /** Base backoff in ms. Clamped to [0, 60_000]. */
  baseDelayMs?: number;
  /** Hard cap on any single backoff in ms. */
  maxDelayMs?: number;
  /** Injectable sleep, used by tests to avoid real timers. */
  sleep?: (ms: number) => Promise<void>;
}

const DEFAULT_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;
const ABSOLUTE_MAX_DELAY_MS = 60_000;

function envInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

const defaultSleep = (ms: number): Promise<void> =>
  ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** Parse a `Retry-After` header (seconds or HTTP-date) into seconds. */
export function parseRetryAfter(value: string | null | undefined, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (trimmed === '') return undefined;

  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.max(0, Number(trimmed));
  }
  const asDate = Date.parse(trimmed);
  if (Number.isNaN(asDate)) return undefined;
  return Math.max(0, (asDate - now) / 1000);
}

/**
 * Run `attempt`, retrying recoverable failures with capped exponential backoff.
 * On 429 the provider's `Retry-After` (when present) takes precedence.
 */
export async function withBoundedRetry<T>(
  label: string,
  attempt: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = Math.round(clamp(options.retries ?? envInt('PROVIDER_MAX_RETRIES', DEFAULT_RETRIES), 0, 5));
  const baseDelayMs = clamp(options.baseDelayMs ?? envInt('PROVIDER_RETRY_BASE_MS', DEFAULT_BASE_DELAY_MS), 0, ABSOLUTE_MAX_DELAY_MS);
  const maxDelayMs = clamp(options.maxDelayMs ?? envInt('PROVIDER_RETRY_MAX_MS', DEFAULT_MAX_DELAY_MS), baseDelayMs, ABSOLUTE_MAX_DELAY_MS);
  const sleep = options.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attemptIndex = 0; attemptIndex <= retries; attemptIndex += 1) {
    try {
      return await attempt();
    } catch (err) {
      lastError = err;
      const recoverable = err instanceof ProviderError ? err.recoverable : true;
      if (!recoverable || attemptIndex === retries) break;

      const retryAfterSeconds = err instanceof ProviderRateLimitError ? err.retryAfterSeconds : undefined;
      const exponential = baseDelayMs * 2 ** attemptIndex;
      const delayMs = retryAfterSeconds !== undefined
        ? clamp(retryAfterSeconds * 1000, 0, maxDelayMs)
        : clamp(exponential, 0, maxDelayMs);

      await sleep(delayMs);
    }
  }

  if (lastError instanceof Error) throw lastError;
  throw new ProviderError(`${label}: ${String(lastError)}`, { provider: 'api-football', recoverable: true });
}

/**
 * Map a non-OK HTTP response onto the correct provider error, classifying
 * quota vs. auth vs. throttling vs. generic client/server failure.
 */
export function providerErrorFromResponse(
  provider: ProviderName,
  status: number,
  bodyText: string,
  retryAfterHeader?: string | null,
): ProviderError {
  const body = bodyText.slice(0, 500);
  const lower = body.toLowerCase();

  if (status === 429) {
    const retryAfterSeconds = parseRetryAfter(retryAfterHeader);
    // Only a *daily/plan* limit is unrecoverable; a plain per-minute throttle is
    // recoverable and must be retried after Retry-After.
    if (/quota|for the day|daily limit|daily request limit|out of requests/.test(lower)) {
      return new ProviderQuotaExhaustedError(provider, `${provider} quota/limit exhausted (429): ${body}`, status);
    }
    return new ProviderRateLimitError(provider, `${provider} rate limited (429): ${body}`, retryAfterSeconds);
  }

  if (status === 401 || status === 403) {
    if (/quota|subscription|not subscribed|plan/.test(lower)) {
      return new ProviderQuotaExhaustedError(provider, `${provider} entitlement exhausted (${status}): ${body}`, status);
    }
    return new ProviderAuthError(provider, status, `${provider} auth failed (${status}): ${body}`);
  }

  const recoverable = status >= 500 || status === 408 || status === 425;
  return new ProviderError(`${provider} request failed (${status}): ${body}`, { provider, status, recoverable });
}
