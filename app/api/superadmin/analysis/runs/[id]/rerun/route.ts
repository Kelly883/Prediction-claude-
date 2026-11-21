import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';
import { runDailyAnalysis } from '@/lib/analysis/run';

export const runtime = 'nodejs';
export const maxDuration = 300;

interface Context {
  params: Promise<{ id: string }>;
}

export async function POST(req: NextRequest, context: Context) {
  try {
    const admin = await requireAnalysisAdmin(req, true);
    const { id } = await context.params;
    const existing = await prisma.analysisRun.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Analysis run not found');

    const result = await runDailyAnalysis({ now: existing.runDate, force: true });
    await writeAudit({
      actorId: admin.sub,
      action: 'analysis.run.rerun',
      targetType: 'analysis_run',
      targetId: result.runId,
      metadata: { sourceRunId: id, status: result.status },
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
