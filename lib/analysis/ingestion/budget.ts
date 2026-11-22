/**
 * Execution-time budget for the daily analysis run (Phase 1 hardening — §6).
 *
 * WHY THIS EXISTS
 *   A single Vercel invocation is wall-clock bounded (the daily-analysis route
 *   sets `maxDuration = 300`). Individual waits (limiter wait, single-flight
 *   wait, retry backoff) being *bounded* does NOT prove the whole run fits: the
 *   sum of many bounded waits across hundreds of fixtures can exceed the
 *   platform ceiling. This module provides (a) a CALCULATED worst-case runtime
 *   model and (b) a live budget guard so the run self-limits and *defers* the
 *   remainder instead of being killed mid-flight or publishing a partial run as
 *   a completed one.
 *
 * EVIDENCE LABELS
 *   - CALCULATED: the estimator below is derived from the verified limits in
 *     lib/api/provider-config.ts (RPS/RPM, retries, timeouts, concurrency).
 *   - VERIFIED: the budget guard's "stop and defer" behaviour is exercised by
 *     unit tests in tests/provider-hardening.test.ts.
 *
 * The estimator is deliberately an UPPER bound (worst case). It is not a claim
 * of observed production latency (that remains NOT VERIFIED until a live run).
 */
import { getProviderConfig, type ProviderConfig } from '@/lib/api/provider-config';

/** Enrichment fan-out per fixture (six parallel provider requests). */
export const ENRICHMENT_REQUESTS_PER_FIXTURE = 6;

export interface RuntimeInputs {
  /** Number of fixtures to analyse in the 48h window. */
  fixtures: number;
  /** Serverless fixture-level concurrency (provider requests per fixture). */
  fixtureConcurrency: number;
  /** Provider HTTP requests issued per fixture (default {@link ENRICHMENT_REQUESTS_PER_FIXTURE}). */
  requestsPerFixture: number;
  /** Sustained requests-per-second of the global provider limiter. */
  providerRps: number;
  /** Sustained requests-per-minute of the global provider limiter. */
  providerRpm: number;
  /** Per-request provider timeout (ms). */
  providerTimeoutMs: number;
  /** Bounded retries per request (each retry is an extra outbound attempt). */
  maxRetries: number;
  /** Fixed database/prediction overhead added once (ms). */
  dbOverheadMs: number;
}

export interface RuntimeEstimate {
  /** Logical provider fetch operations (before retries). */
  logicalRequests: number;
  /** Worst-case outbound HTTP attempts (logical + bounded retries). */
  worstCaseRequests: number;
  /** Effective sustained rate (req/s) = min(rps, rpm/60). */
  effectiveRps: number;
  /** Lower bound imposed by the shared provider limiter (ms). */
  limiterBoundMs: number;
  /** Lower bound imposed by fixture concurrency × provider timeout (ms). */
  concurrencyBoundMs: number;
  /** Upper-bound estimate = max(limiter, concurrency) + db overhead (ms). */
  estimatedMs: number;
  inputs: RuntimeInputs;
}

/** Default per-request provider timeout used by the HTTP layer (ms). */
export const DEFAULT_PROVIDER_TIMEOUT_MS = 15_000;
/** Fixed estimate for prediction + transactional DB writes (ms). */
export const DEFAULT_DB_OVERHEAD_MS = 5_000;

/** Build estimator inputs from the validated provider configuration. */
export function runtimeInputs(
  fixtures: number,
  cfg: ProviderConfig = getProviderConfig(),
  overrides: Partial<RuntimeInputs> = {},
): RuntimeInputs {
  const maxRetries = Number.parseInt(process.env.PROVIDER_MAX_RETRIES ?? '2', 10);
  return {
    fixtures,
    fixtureConcurrency: cfg.enrichmentConcurrency,
    requestsPerFixture: ENRICHMENT_REQUESTS_PER_FIXTURE,
    providerRps: cfg.apiFootballRps,
    providerRpm: cfg.apiFootballRpm,
    providerTimeoutMs: DEFAULT_PROVIDER_TIMEOUT_MS,
    maxRetries: Number.isFinite(maxRetries) ? Math.max(0, maxRetries) : 2,
    dbOverheadMs: DEFAULT_DB_OVERHEAD_MS,
    ...overrides,
  };
}

/**
 * CALCULATED worst-case runtime for `inputs.fixtures` fixtures.
 *
 *   logicalRequests      = fixtures × requestsPerFixture
 *   worstCaseRequests    = logicalRequests × (1 + maxRetries)
 *   effectiveRps         = min(providerRps, providerRpm / 60)
 *   limiterBoundMs       = ceil(worstCaseRequests / effectiveRps) × 1000
 *   concurrencyBoundMs   = ceil(fixtures / fixtureConcurrency) × providerTimeoutMs
 *   estimatedMs          = max(limiterBoundMs, concurrencyBoundMs) + dbOverheadMs
 */
export function estimateRuntimeMs(input: RuntimeInputs): RuntimeEstimate {
  const logicalRequests = input.fixtures * input.requestsPerFixture;
  const worstCaseRequests = logicalRequests * (1 + input.maxRetries);
  const effectiveRps = Math.max(0.0001, Math.min(input.providerRps, input.providerRpm / 60));
  const limiterBoundMs = Math.ceil(worstCaseRequests / effectiveRps) * 1000;
  const concurrencyBoundMs =
    Math.ceil(input.fixtures / Math.max(1, input.fixtureConcurrency)) * input.providerTimeoutMs;
  const estimatedMs = Math.max(limiterBoundMs, concurrencyBoundMs) + input.dbOverheadMs;

  return {
    logicalRequests,
    worstCaseRequests,
    effectiveRps,
    limiterBoundMs,
    concurrencyBoundMs,
    estimatedMs,
    inputs: input,
  };
}

/** A monotonic wall-clock budget for a single invocation. */
export interface RunBudget {
  /** Epoch ms at which the invocation must stop starting new work. */
  deadlineMs: number;
  /** True once the deadline has passed. */
  expired(): boolean;
  /** Milliseconds left before the deadline (never negative). */
  remainingMs(): number;
}

/** Create a budget of `maxRuntimeMs` starting at `now()` (defaults to Date.now). */
export function createRunBudget(maxRuntimeMs: number, now: () => number = Date.now): RunBudget {
  const deadlineMs = now() + Math.max(0, maxRuntimeMs);
  return {
    deadlineMs,
    expired: () => now() >= deadlineMs,
    remainingMs: () => Math.max(0, deadlineMs - now()),
  };
}
