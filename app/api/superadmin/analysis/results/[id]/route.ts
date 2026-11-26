import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

export const runtime = 'nodejs';

interface Context {
  params: Promise<{ id: string }>;
}

const ReviewSchema = z.object({
  status: z.enum(['approved', 'dismissed']),
  dismissalReason: z.string().trim().max(500).optional(),
  notes: z.string().trim().max(1000).optional(),
});

export async function GET(req: NextRequest, context: Context) {
  try {
    await requireAnalysisAdmin(req);
    const { id } = await context.params;
    const result = await prisma.analysisResult.findUnique({ where: { id } });
    if (!result) throw new ApiError(404, 'Analysis result not found');
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, context: Context) {
  try {
    const admin = await requireAnalysisAdmin(req, true);
    const { id } = await context.params;
    const dto = ReviewSchema.parse(await req.json());
    if (dto.status === 'dismissed' && !dto.dismissalReason) {
      throw new ApiError(400, 'dismissalReason is required when dismissing a pick');
    }

    const existing = await prisma.analysisResult.findUnique({ where: { id }, include: { run: true } });
    if (!existing) throw new ApiError(404, 'Analysis result not found');
    if (existing.status === 'published') throw new ApiError(409, 'Published picks cannot be reviewed');

    // A pick may only be approved when its parent run reached a completed
    // terminal state. Results from failed, running, pending or deferred runs
    // must never become approvable. Dismissal remains available for any
    // non-published result, including results from failed runs.
    if (dto.status === 'approved' && existing.run.status !== 'completed') {
      throw new ApiError(409, `Cannot approve a result whose parent run is ${existing.run.status}`);
    }

    // Optimistic concurrency guard: only transition the result if its status is
    // still what we observed, so a concurrent state change cannot be silently
    // overwritten. A count of 0 means another request changed it first —
    // surface a conflict instead of acting on stale data.
    const updated = await prisma.analysisResult.updateMany({
      where: { id, status: existing.status },
      data: {
        status: dto.status,
        reviewedById: admin.sub,
        reviewedAt: new Date(),
        dismissalReason: dto.status === 'dismissed' ? dto.dismissalReason : null,
      },
    });
    if (updated.count === 0) {
      throw new ApiError(409, 'This pick was already reviewed by another request');
    }

    const current = await prisma.analysisResult.findUnique({ where: { id } });
    if (!current) throw new ApiError(404, 'Analysis result not found');

    await writeAudit({
      actorId: admin.sub,
      action: dto.status === 'approved' ? 'analysis.pick.approve' : 'analysis.pick.dismiss',
      targetType: 'analysis_result',
      targetId: id,
      metadata: {
        previousStatus: existing.status,
        notes: dto.notes,
        dismissalReason: dto.dismissalReason,
      },
    });

    return NextResponse.json(current);
  } catch (err) {
    return errorResponse(err);
  }
}
