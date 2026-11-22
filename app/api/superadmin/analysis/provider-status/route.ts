import { NextRequest, NextResponse } from 'next/server';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';
import { errorResponse } from '@/lib/rbac';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';
import { getProviderQuota, assessQuota, refreshProviderQuota } from '@/lib/api/quota';
import { getRateLimitConfig } from '@/lib/api/rate-limiter';
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
    const config = getProviderConfig();

    return NextResponse.json({
      quota: {
        provider: quota.provider,
        plan: quota.plan ?? null,
        subscriptionEnd: quota.subscriptionEnd ?? null,
        dailyLimit: quota.dailyLimit,
        consumed: quota.consumed,
        remaining: quota.remaining,
        lastCheckedAt: quota.lastCheckedAt,
        status: quota.status,
        source: quota.source,
        level: assessment.level,
        consumedRatio: assessment.consumedRatio,
        reason: assessment.reason,
      },
      rateLimit: {
        // Internal safety limits (NOT the provider's published plan limits).
        requestsPerSecond: rateLimit.perSecond,
        requestsPerMinute: rateLimit.perMinute,
        maxWaitMs: rateLimit.maxWaitMs,
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
          }
        : null,
    });
  } catch (err) {
    return errorResponse(err);
  }
}
