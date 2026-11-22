/**
 * Structured provider failure classification (Phase 1 — Stage 4).
 *
 * Turns a thrown error into a stable category so retry, fallback and ingestion
 * gating can make consistent decisions and operators can alert on a category
 * rather than a free-text message. The critical distinction is *fatal* (auth,
 * invalid key, quota) — which must stop automated ingestion with no retry
 * storm — versus *recoverable* (network, timeout, 5xx, 429) which may be
 * retried under the bounded retry policy.
 */
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
} from '@/lib/api/retry';

export type ProviderFailureCategory =
  | 'auth'
  | 'invalid_key'
  | 'quota'
  | 'rate_limit'
  | 'network'
  | 'timeout'
  | 'server'
  | 'invalid_response'
  | 'missing_data'
  | 'unknown';

export interface ProviderFailure {
  category: ProviderFailureCategory;
  /** Whether a bounded retry could plausibly succeed. */
  recoverable: boolean;
  message: string;
  status?: number;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Map any thrown error into a provider failure classification. */
export function classifyProviderFailure(err: unknown): ProviderFailure {
  if (err instanceof ProviderQuotaExhaustedError) {
    return { category: 'quota', recoverable: false, message: err.message, status: err.status };
  }
  if (err instanceof ProviderRateLimitError) {
    return { category: 'rate_limit', recoverable: true, message: err.message, status: err.status };
  }
  if (err instanceof ProviderAuthError) {
    // 401 => the key is missing/invalid; anything else (e.g. 403 not subscribed)
    // is an entitlement problem. Both stop ingestion, but they differ on-call.
    const category: ProviderFailureCategory = err.status === 401 ? 'invalid_key' : 'auth';
    return { category, recoverable: false, message: err.message, status: err.status };
  }
  if (err instanceof ProviderError) {
    if (err.status !== undefined && err.status >= 500) {
      return { category: 'server', recoverable: err.recoverable, message: err.message, status: err.status };
    }
    return {
      category: err.recoverable ? 'network' : 'invalid_response',
      recoverable: err.recoverable,
      message: err.message,
      status: err.status,
    };
  }
  if (err instanceof Error) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError' || /timeout|timed out|aborted/i.test(err.message)) {
      return { category: 'timeout', recoverable: true, message: err.message };
    }
    if (err.name === 'TypeError' || /fetch failed|network|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(err.message)) {
      return { category: 'network', recoverable: true, message: err.message };
    }
    return { category: 'unknown', recoverable: true, message: err.message };
  }
  return { category: 'unknown', recoverable: true, message: messageOf(err) };
}

/** Categories that must stop automated ingestion (never retried). */
export function isFatalProviderCategory(category: ProviderFailureCategory): boolean {
  return category === 'auth' || category === 'invalid_key' || category === 'quota';
}

/** A provider produced no usable data for the request (not an error, but a gap). */
export function missingData(): ProviderFailure {
  return { category: 'missing_data', recoverable: false, message: 'Provider returned no usable data' };
}
