import { redis } from '@/lib/redis';
import { ProviderError, type ProviderName } from '@/lib/api/retry';

/**
 * Distributed provider circuit breaker.
 *
 * Repeated failures against an unhealthy provider are counted in Redis (shared
 * across serverless instances, unlike the in-memory fallback). When the failure
 * threshold is reached the circuit "opens" for a cooldown window and calls
 * short-circuit with {@link ProviderCircuitOpenError} instead of hammering the
 * provider. A cooldown expiry naturally allows a probe request; a success resets
 * the breaker.
 *
 * Only *recoverable* failures trip the breaker. `ProviderAuthError` and
 * `ProviderQuotaExhaustedError` are configuration/entitlement problems that are
 * surfaced separately and must not be masked by an open circuit.
 */

const DEFAULT_FAILURE_THRESHOLD = 5;
const DEFAULT_WINDOW_SECONDS = 120;
const DEFAULT_COOLDOWN_SECONDS = 60;

export class ProviderCircuitOpenError extends ProviderError {
  constructor(provider: ProviderName) {
    super(`${provider} circuit is open after repeated failures`, { provider, recoverable: false });
    this.name = 'ProviderCircuitOpenError';
  }
}

function positiveInt(name: string, fallback: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
}

function failureThreshold(): number {
  return positiveInt('PROVIDER_CIRCUIT_THRESHOLD', DEFAULT_FAILURE_THRESHOLD);
}

function windowSeconds(): number {
  return positiveInt('PROVIDER_CIRCUIT_WINDOW_SECONDS', DEFAULT_WINDOW_SECONDS);
}

function cooldownSeconds(): number {
  return positiveInt('PROVIDER_CIRCUIT_COOLDOWN_SECONDS', DEFAULT_COOLDOWN_SECONDS);
}

function failureKey(provider: ProviderName): string {
  return `provider:circuit:failures:${provider}`;
}

function openKey(provider: ProviderName): string {
  return `provider:circuit:open:${provider}`;
}

export async function isProviderCircuitOpen(provider: ProviderName): Promise<boolean> {
  try {
    return (await redis.get(openKey(provider))) !== null;
  } catch {
    // If Redis is unreachable we cannot know the breaker state; fail open so a
    // Redis outage does not itself take down the ingestion pipeline.
    return false;
  }
}

/** Throw if the provider's circuit is currently open. */
export async function assertProviderAvailable(provider: ProviderName): Promise<void> {
  if (await isProviderCircuitOpen(provider)) {
    throw new ProviderCircuitOpenError(provider);
  }
}

/** Record a recoverable failure; trip the breaker once the threshold is reached. */
export async function recordProviderFailure(provider: ProviderName): Promise<void> {
  try {
    const key = failureKey(provider);
    const failures = await redis.incr(key);
    if (failures === 1) {
      await redis.expire(key, windowSeconds());
    }
    if (failures >= failureThreshold()) {
      await redis.set(openKey(provider), '1', { ex: cooldownSeconds() });
      await redis.del(key);
    }
  } catch {
    // Breaker bookkeeping must never fail the request path.
  }
}

/** Reset the breaker after a successful request. */
export async function recordProviderSuccess(provider: ProviderName): Promise<void> {
  try {
    await redis.del(failureKey(provider));
    await redis.del(openKey(provider));
  } catch {
    // ignore
  }
}
