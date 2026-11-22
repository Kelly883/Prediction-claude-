import { NextRequest, NextResponse } from 'next/server';
import { timingSafeStringEqual } from '@/lib/timing-safe';
import { getRequestId, withRequestId } from '@/lib/request-id';
import { errorResponse } from '@/lib/rbac';
import { refreshProviderQuota, assessQuota } from '@/lib/api/quota';

export const runtime = 'nodejs';
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const header = req.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET && header && timingSafeStringEqual(header, expected));
}

/**
 * Provider quota refresh cron (Phase 1 — Stage 3).
 *
 * Polls the API-Football `/status` endpoint (which does NOT count against the
 * daily quota) and stores a quota snapshot for the ingestion gate to read. This
 * route is intentionally isolated from the analysis run so the daily run never
 * performs a live quota refresh inline.
 *
 * NOTE: scheduling this route is a production-configuration step and is NOT
 * part of this change (the production cron schedule must not be modified here).
 */
async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return withRequestId(req, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    const now = new Date();
    const snapshot = await refreshProviderQuota(now);
    const assessment = assessQuota(snapshot);
    return withRequestId(req, NextResponse.json({
      status: snapshot.status,
      source: snapshot.source,
      dailyLimit: snapshot.dailyLimit,
      consumed: snapshot.consumed,
      remaining: snapshot.remaining,
      level: assessment.level,
      reason: assessment.reason,
      lastCheckedAt: snapshot.lastCheckedAt,
      requestId: getRequestId(req),
    }));
  } catch (err) {
    return withRequestId(req, errorResponse(err));
  }
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}
