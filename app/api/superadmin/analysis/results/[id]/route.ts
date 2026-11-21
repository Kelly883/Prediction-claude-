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

    const existing = await prisma.analysisResult.findUnique({ where: { id } });
    if (!existing) throw new ApiError(404, 'Analysis result not found');
    if (existing.status === 'published') throw new ApiError(409, 'Published picks cannot be reviewed');

    const updated = await prisma.analysisResult.update({
      where: { id },
      data: {
        status: dto.status,
        reviewedById: admin.sub,
        reviewedAt: new Date(),
        dismissalReason: dto.status === 'dismissed' ? dto.dismissalReason : null,
      },
    });

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

    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
