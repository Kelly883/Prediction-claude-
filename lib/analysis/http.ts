/**
 * Shared HTTP client for football data providers with:
 *  - 429 rate-limit handling (honors Retry-After, then exponential backoff)
 *  - bounded exponential backoff for transient failures (5xx, network, timeout)
 *  - NO retry of non-recoverable errors (4xx other than 429)
 *  - optional circuit breaking per provider to prevent hammering a failing API
 *
 * This is intentionally provider-agnostic: callers pass the URL, headers, and a
 * label used for logging/circuit-breaker keys.
 */

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8_000;

export class NonRetryableError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

/**
 * Thrown when a provider's circuit breaker is open. Callers should treat this
 * as "provider temporarily unavailable" — the run can proceed with partial
 * data rather than hammering a failing API.
 */
export class CircuitOpenError extends Error {
  constructor(public readonly providerLabel: string) {
    super(`Circuit open for ${providerLabel}; request skipped to avoid hammering a failing provider`);
    this.name = 'CircuitOpenError';
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeBackoff(attempt: number, base: number, max: number): number {
  const exp = Math.min(max, base * 2 ** attempt);
  // Full jitter to avoid thundering-herd retries.
  return Math.floor(Math.random() * exp);
}

function parseRetryAfterMs(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const date = Date.parse(header);
  if (Number.isFinite(date)) return Math.max(0, date - Date.now());
  return undefined;
}

/**
 * Executes a fetch with retry/backoff. Returns the raw Response on success.
 * Throws NonRetryableError for 4xx (except 429) so callers can distinguish
 * "do not retry" from "provider unavailable".
 */
export async function fetchWithRetry(
  label: string,
  url: string,
  init: RequestInit,
  options: RetryOptions = {},
): Promise<Response> {
  const maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  const base = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const max = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    // Fail fast while the circuit is open instead of hammering a failing API.
    if (!circuitAllows(label)) {
      throw new CircuitOpenError(label);
    }

    try {
      const response = await fetch(url, init);

      if (response.ok) {
        recordCircuitSuccess(label);
        return response;
      }

      // 429: rate limited — honor Retry-After, then back off.
      if (response.status === 429) {
        const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'));
        if (attempt < maxRetries) {
          const delay = retryAfterMs ?? computeBackoff(attempt, base, max);
          await sleep(delay);
          continue;
        }
        // Exhausted retries on rate limiting: the provider is overwhelmed, so
        // record a circuit failure before propagating to trigger cooldown.
        recordCircuitFailure(label);
        throw new NonRetryableError(`${label} rate limited (429) after ${maxRetries} retries`, 429);
      }

      // Other 4xx: non-recoverable (bad request, auth, not found). This is a
      // per-request problem, NOT a provider-health signal, so it must NOT open
      // the circuit. Do not retry.
      if (response.status >= 400 && response.status < 500) {
        throw new NonRetryableError(`${label} request failed: ${response.status}`, response.status);
      }

      // 5xx: server error — retry with backoff. Exhaustion is recorded as a
      // circuit failure in the catch block below (single record per request).
      if (attempt < maxRetries) {
        await sleep(computeBackoff(attempt, base, max));
        continue;
      }
      throw new Error(`${label} server error (${response.status}) after ${maxRetries} retries`);
    } catch (err) {
      // Non-retryable 4xx and open-circuit signals propagate without touching
      // circuit state (per-request errors are not provider-health signals).
      if (err instanceof NonRetryableError) throw err;
      if (err instanceof CircuitOpenError) throw err;
      lastError = err;
      if (attempt < maxRetries) {
        await sleep(computeBackoff(attempt, base, max));
        continue;
      }
      // Network/abort or 5xx exhausted: provider is failing.
      recordCircuitFailure(label);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(`${label} failed after ${maxRetries} retries`);
}

/**
 * Simple per-provider circuit breaker. After `failureThreshold` consecutive
 * failures the circuit opens for `openMs`, during which calls fail fast without
 * hitting the network. A successful call closes the circuit.
 *
 * This is intentionally lightweight and in-process; a distributed breaker can
 * be layered on in Stage 4 if needed.
 */
interface CircuitState {
  failures: number;
  openedAt: number | null;
}

const circuits = new Map<string, CircuitState>();
const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_OPEN_MS = 60_000;

export function circuitAllows(providerLabel: string): boolean {
  const state = circuits.get(providerLabel);
  if (!state || state.openedAt === null) return true;
  if (Date.now() - state.openedAt >= DEFAULT_OPEN_MS) {
    // Half-open: allow a trial call.
    circuits.set(providerLabel, { failures: 0, openedAt: null });
    return true;
  }
  return false;
}

export function recordCircuitSuccess(providerLabel: string): void {
  circuits.set(providerLabel, { failures: 0, openedAt: null });
}

export function recordCircuitFailure(providerLabel: string): void {
  const state = circuits.get(providerLabel) ?? { failures: 0, openedAt: null };
  const failures = state.failures + 1;
  if (failures >= DEFAULT_FAILURE_THRESHOLD) {
    circuits.set(providerLabel, { failures, openedAt: Date.now() });
  } else {
    circuits.set(providerLabel, { failures, openedAt: null });
  }
}

export function circuitState(providerLabel: string): { failures: number; open: boolean } {
  const state = circuits.get(providerLabel);
  if (!state) return { failures: 0, open: false };
  const open = state.openedAt !== null && Date.now() - state.openedAt < DEFAULT_OPEN_MS;
  return { failures: state.failures, open };
}