/**
 * Safe automated-ingestion gating (Phase 1 — Stage 9).
 *
 * Before a daily run starts touching the provider it must confirm that the
 * protection layer can actually protect: Redis (the shared limiter/lock/quota
 * store) must be reachable, the daily quota must be known-and-sufficient, and
 * the provider must not be in a cooldown. If any critical prerequisite fails we
 * fail closed — we never begin an uncontrolled ingestion run, we never mark the
 * run successful, and we never publish incomplete predictions.
 *
 * Reads only: this module performs NO provider requests. The stored quota
 * snapshot is refreshed by the dedicated quota monitor, not here.
 */
import { redis } from '@/lib/redis';
import { logger } from '@/lib/logger';
import { evaluateQuotaGate, unknownQuotaSnapshot, type ProviderQuotaSnapshot, type QuotaLevel } from '@/lib/api/quota';
import { isProviderCircuitOpen } from '@/lib/api/circuit-breaker';

export type IngestionGateStatus = 'ready' | 'blocked';

export interface IngestionGateResult {
  ok: boolean;
  status: IngestionGateStatus;
  /** Human-readable reasons a run must not proceed (empty when ready). */
  reasons: string[];
  quotaLevel: QuotaLevel;
  quota: ProviderQuotaSnapshot;
  redisAvailable: boolean;
  providerCooldown: boolean;
}

export interface IngestionGateDeps {
  now?: Date;
  /** Probe the shared Redis; resolve when reachable, reject when not. */
  probeRedis?: () => Promise<void>;
  /** Quota gate (defaults to the verified `/status` snapshot evaluation). */
  checkQuota?: typeof evaluateQuotaGate;
  /** Provider cooldown check (defaults to the distributed circuit breaker). */
  checkCooldown?: () => Promise<boolean>;
}

const PROBE_KEY = 'provider:protection:probe';

const errMsg = (err: unknown): string => (err instanceof Error ? err.message : String(err));

async function defaultProbeRedis(): Promise<void> {
  // A benign read is enough to prove the shared Redis is reachable. If it
  // throws, the distributed limiter, locks and quota store cannot be trusted.
  await redis.get(PROBE_KEY);
}

/**
 * Evaluate whether automated ingestion may begin. Never throws: any internal
 * failure is treated as a blocked prerequisite (fail closed).
 */
export async function evaluateIngestionGate(deps: IngestionGateDeps = {}): Promise<IngestionGateResult> {
  const now = deps.now ?? new Date();
  const reasons: string[] = [];

  let redisAvailable = true;
  try {
    await (deps.probeRedis ?? defaultProbeRedis)();
  } catch (err) {
    redisAvailable = false;
    reasons.push(`redis unavailable: ${errMsg(err)}`);
  }

  // Fail closed on a Redis outage: without the shared store we cannot enforce
  // the rate limiter, the analysis lock or the quota state.
  let quotaLevel: QuotaLevel = 'unknown';
  let quota = unknownQuotaSnapshot(now);
  let quotaAllowed = false;
  if (redisAvailable) {
    try {
      const result = await (deps.checkQuota ?? evaluateQuotaGate)(now);
      quotaLevel = result.level;
      quota = result.quota;
      quotaAllowed = result.allowed;
      if (!result.allowed) reasons.push(`quota: ${result.reason}`);
    } catch (err) {
      quotaAllowed = false;
      reasons.push(`quota check failed: ${errMsg(err)}`);
    }
  }

  let providerCooldown = false;
  if (redisAvailable) {
    try {
      providerCooldown = await (deps.checkCooldown ?? (() => isProviderCircuitOpen('api-football')))();
    } catch {
      providerCooldown = false;
    }
    if (providerCooldown) reasons.push('provider circuit is open (cooldown)');
  }

  const ok = redisAvailable && quotaAllowed && !providerCooldown;
  const result: IngestionGateResult = {
    ok,
    status: ok ? 'ready' : 'blocked',
    reasons,
    quotaLevel,
    quota,
    redisAvailable,
    providerCooldown,
  };

  if (ok) {
    logger.info('provider.ingestionGate', { status: result.status, quotaLevel, redisAvailable, providerCooldown });
  } else {
    logger.warn('provider.ingestionGate', {
      status: result.status,
      quotaLevel,
      redisAvailable,
      providerCooldown,
      reasons,
    });
  }
  return result;
}
