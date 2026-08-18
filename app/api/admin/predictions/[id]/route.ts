import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, requireAdminWith2FA, errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { UpdatePredictionSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
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
    const admin = await requireAdminWith2FA(req);
    const { id } = await params;
    const dto = UpdatePredictionSchema.parse(await req.json());
    const data: any = { ...dto };
    if (dto.scheduledAt) data.scheduledAt = new Date(dto.scheduledAt);
    if (dto.freeUntil !== undefined) data.freeUntil = dto.freeUntil ? new Date(dto.freeUntil) : null;

    const post = await prisma.predictionPost.update({ where: { id }, data });
    await writeAudit({ actorId: admin.sub, action: 'prediction.update', targetId: post.id, metadata: dto });
    return NextResponse.json(post);
  } catch (err) {
    return errorResponse(err);
  }
}
