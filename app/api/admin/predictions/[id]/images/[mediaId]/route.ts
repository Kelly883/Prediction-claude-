import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse, ApiError } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { deleteMedia } from '@/lib/media';
import { writeAudit } from '@/lib/audit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.predictions);
    const { id: postId, mediaId } = await params;

    const media = await prisma.mediaAsset.findUnique({
      where: { id: mediaId },
      select: { id: true, postId: true },
    });

    if (!media || media.postId !== postId) {
      throw new ApiError(404, 'Media not found');
    }

    await deleteMedia(postId, mediaId);

    await writeAudit({
      actorId: admin.sub,
      action: 'prediction.image_delete',
      targetId: postId,
      metadata: { mediaId },
    });

    return NextResponse.json({
      success: true,
      message: 'Prediction image deleted successfully.',
    });
  } catch (err) {
    return errorResponse(err);
  }
}
