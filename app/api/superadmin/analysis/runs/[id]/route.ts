import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

export const runtime = 'nodejs';

interface Context {
  params: Promise<{ id: string }>;
}

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireAnalysisAdmin(req);
    const { id } = await context.params;
    const run = await prisma.analysisRun.findUnique({
      where: { id },
      include: { results: { orderBy: { confidence: 'desc' } } },
    });
    if (!run) throw new ApiError(404, 'Analysis run not found');
    return NextResponse.json({
      ...run,
      // `modelScore` mirrors the stored heuristic `confidence` under an honest,
      // non-probabilistic name (audit §E); `confidence` is retained for
      // backwards compatibility.
      results: run.results.map((result) => ({ ...result, modelScore: Number(result.confidence) })),
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: NextRequest, context: Context) {
  try {
    const admin = await requireAnalysisAdmin(req, true);
    const { id } = await context.params;
    const run = await prisma.analysisRun.findUnique({ where: { id } });
    if (!run) throw new ApiError(404, 'Analysis run not found');
    if (run.status === 'running' || run.status === 'completed') {
      throw new ApiError(409, 'Only pending or failed runs can be deleted');
    }

    await prisma.analysisRun.delete({ where: { id } });
    await writeAudit({
      actorId: admin.sub,
      action: 'analysis.run.delete',
      targetType: 'analysis_run',
      targetId: id,
      metadata: { previousStatus: run.status },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
