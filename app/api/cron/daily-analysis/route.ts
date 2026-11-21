import { NextRequest, NextResponse } from 'next/server';
import { timingSafeStringEqual } from '@/lib/timing-safe';
import { getRequestId, withRequestId } from '@/lib/request-id';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { runDailyAnalysis } from '@/lib/analysis/run';

export const runtime = 'nodejs';
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  const header = req.headers.get('authorization');
  return Boolean(process.env.CRON_SECRET && header && timingSafeStringEqual(header, expected));
}

async function handle(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return withRequestId(req, NextResponse.json({ error: 'Unauthorized' }, { status: 401 }));
  }

  try {
    let force = false;
    if (req.method === 'POST') {
      try {
        const body = await req.json() as { force?: boolean };
        force = body?.force === true;
      } catch {
        force = false;
      }
    }

    const result = await runDailyAnalysis({ force });
    await writeAudit({
      actorId: null,
      action: 'analysis.run',
      targetType: 'analysis_run',
      targetId: result.runId,
      metadata: {
        status: result.status,
        fixturesAnalyzed: result.fixturesAnalyzed,
        picksGenerated: result.picksGenerated,
        alreadyRunning: result.alreadyRunning,
        errorCount: result.errors?.length ?? 0,
      },
    });

    return withRequestId(req, NextResponse.json({
      runId: result.runId,
      status: result.status,
      fixturesAnalyzed: result.fixturesAnalyzed,
      picksGenerated: result.picksGenerated,
      alreadyRunning: result.alreadyRunning ?? false,
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
