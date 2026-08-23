import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse, ApiError } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { writeAudit } from '@/lib/audit';
import { UpdatePredictionSchema } from '@/lib/schemas';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission(req, PERMISSIONS.pages.predictions);
    const { id } = await params;
    const post = await prisma.predictionPost.findUnique({
      where: { id },
      include: { items: true, media: true },
    });
    if (!post) throw new ApiError(404, 'Not found');
    return NextResponse.json(post);
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.predictions);
    const { id } = await params;
    const dto = UpdatePredictionSchema.parse(await req.json());
    const data: any = { ...dto };
    if (dto.scheduledAt) data.scheduledAt = new Date(dto.scheduledAt);
    if (dto.freeUntil !== undefined) data.freeUntil = dto.freeUntil ? new Date(dto.freeUntil) : null;

    if (dto.outcome && ['won', 'lost'].includes(dto.outcome)) {
      data.status = 'archived';
    }

    const post = await prisma.predictionPost.findUnique({ where: { id }, include: { items: true } });
    if (!post) throw new ApiError(404, 'Not found');

    const updatePayload: any = { ...data };
    if (dto.items) {
      updatePayload.items = {
        deleteMany: {},
        create: dto.items.map((item) => ({
          match: item.match,
          prediction: item.prediction,
          matchDateTime: item.matchDateTime ? new Date(item.matchDateTime) : undefined,
        })),
      };
    }

    const updated = await prisma.predictionPost.update({ where: { id }, data: updatePayload });
    await writeAudit({ actorId: admin.sub, action: 'prediction.update', targetId: updated.id, metadata: dto });
    return NextResponse.json(updated);
  } catch (err) {
    return errorResponse(err);
  }
}
