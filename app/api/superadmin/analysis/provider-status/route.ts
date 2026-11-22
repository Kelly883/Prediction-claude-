import { NextRequest, NextResponse } from 'next/server';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';
import { errorResponse } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getProviderQuota, assessQuota, refreshProviderQuota } from '@/lib/api/quota';
import { getRateLimitConfig, getFootballDataRateLimitConfig } from '@/lib/api/rate-limiter';
import { readProviderMetrics } from '@/lib/api/provider-metrics';
import { isProviderCircuitOpen } from '@/lib/api/circuit-breaker';
import { getProviderConfig } from '@/lib/api/provider-config';

export const runtime = 'nodejs';

/**
 * Superadmin provider-protection monitoring (Phase 1 — Stage 8).
 *
 * Read-only view of quota state, rate-limit configuration, request/cache
 * metrics, circuit state and the last ingestion run. Guarded by the existing
 * superadmin analysis authorization — never exposed to ordinary users — and it
 * never returns provider credentials (only numeric quota/config values).
 *
 * `?refresh=1` asks the quota monitor to re-poll the provider `/status`
 * endpoint first; that is the only path here that performs a provider request
 * (and it still passes through the global distributed rate limiter).
 */
export async function GET(req: NextRequest) {
  try {
    await requireAnalysisAdmin(req);

    const now = new Date();
    const url = new URL(req.url);
    const shouldRefresh = url.searchParams.get('refresh') === '1';

    if (shouldRefresh) {
      try {
        await refreshProviderQuota(now);
      } catch (err) {
        // Refresh is best-effort: a provider failure must still return the last
        // known snapshot (marked STALE by staleness rules), not a 500.
        logger.warn('provider.quota.refreshFailed', { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const [quota, apiFootballOpen, footballDataOpen, metrics, lastRun] = await Promise.all([
      getProviderQuota(now),
      isProviderCircuitOpen('api-football'),
      isProviderCircuitOpen('football-data'),
      readProviderMetrics(now),
      prisma.analysisRun.findFirst({ orderBy: { createdAt: 'desc' } }),
    ]);

    const assessment = assessQuota(quota);
    const rateLimit = getRateLimitConfig();
    const footballDataLimiter = getFootballDataRateLimitConfig();
    const config = getProviderConfig();

    // Quota freshness: how long ago the snapshot was verified. A STALE/UNKNOWN
    // snapshot blocks automated ingestion under the default policy.
    const checkedMs = Date.parse(quota.lastCheckedAt);
    const quotaAgeSeconds = Number.isFinite(checkedMs) ? Math.max(0, Math.round((now.getTime() - checkedMs) / 1000)) : null;
    const quotaFresh = quota.status === 'OK' && quotaAgeSeconds !== null && quotaAgeSeconds <= config.quotaFreshnessSeconds;

    // Cache effectiveness (provider-agnostic) — a hit is never a provider request.
    const cacheLookups = metrics.cacheHits + metrics.cacheMisses;
    const cacheHitRate = cacheLookups > 0 ? metrics.cacheHits / cacheLookups : null;

    return NextResponse.json({
      quota: {
        provider: quota.provider,
        plan: quota.plan ?? null,
        subscriptionEnd: quota.subscriptionEnd ?? null,
        // DAILY window (drives the ingestion gate). Every value carries the
        // source it was read from / derived from.
        dailyLimit: quota.dailyLimit,
        dailyLimitSource: quota.dailyLimitSource,
        consumed: quota.consumed,
        consumedSource: quota.consumedSource,
        remaining: quota.remaining,
        remainingSource: quota.remainingSource,
        // PER-MINUTE window (observability only — never feeds daily quota).
        perMinuteLimit: quota.perMinuteLimit,
        perMinuteLimitSource: quota.perMinuteLimitSource,
        perMinuteRemaining: quota.perMinuteRemaining,
        perMinuteRemainingSource: quota.perMinuteRemainingSource,
        lastCheckedAt: quota.lastCheckedAt,
        status: quota.status,
        source: quota.source,
        level: assessment.level,
        consumedRatio: assessment.consumedRatio,
        reason: assessment.reason,
      },
      quotaFreshness: {
        lastRefreshedAt: quota.lastCheckedAt,
        ageSeconds: quotaAgeSeconds,
        freshnessWindowSeconds: config.quotaFreshnessSeconds,
        fresh: quotaFresh,
        status: quota.status,
      },
      rateLimit: {
        // Internal safety limits (NOT the provider's published plan limits).
        requestsPerSecond: rateLimit.perSecond,
        requestsPerMinute: rateLimit.perMinute,
        maxWaitMs: rateLimit.maxWaitMs,
      },
      footballDataLimiter: {
        // The Football-Data.org limiter is SEPARATE and independently configured.
        requestsPerSecond: footballDataLimiter.perSecond,
        requestsPerMinute: footballDataLimiter.perMinute,
        maxWaitMs: footballDataLimiter.maxWaitMs,
      },
      thresholds: {
        warning: config.quotaWarningThreshold,
        critical: config.quotaCriticalThreshold,
        stop: config.quotaStopThreshold,
        unknownPolicy: config.quotaUnknownPolicy,
      },
      circuits: {
        'api-football': apiFootballOpen ? 'open' : 'closed',
        'football-data': footballDataOpen ? 'open' : 'closed',
      },
      cache: {
        hits: metrics.cacheHits,
        misses: metrics.cacheMisses,
        hitRate: cacheHitRate,
        readFailures: metrics.cacheReadFailures,
        writeFailures: metrics.cacheWriteFailures,
      },
      singleFlight: {
        lockAcquisitions: metrics.singleFlightLockAcquisitions,
        contention: metrics.singleFlightContention,
        lockUnavailable: metrics.singleFlightLockUnavailable,
        waiterTimeouts: metrics.singleFlightWaiterTimeouts,
        failures: metrics.singleFlightFailures,
      },
      // Provider-specific counters (api-football vs football-data) plus
      // cache/single-flight counters are all namespaced in `metrics`.
      metrics,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            status: lastRun.status,
            runDate: lastRun.runDate,
            fixturesAnalyzed: lastRun.fixturesAnalyzed,
            picksGenerated: lastRun.picksGenerated,
            startedAt: lastRun.startedAt,
            completedAt: lastRun.completedAt,
            errorMessage: lastRun.errorMessage,
            // A non-completed run surfaces why: deferred (budget) or failed.
            blockedReason: lastRun.status === 'deferred' ? 'execution budget exhausted; resume pending' : lastRun.errorMessage,
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
