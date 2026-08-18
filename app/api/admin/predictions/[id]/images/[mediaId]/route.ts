import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, requireAdminWith2FA, errorResponse } from '@/lib/rbac';
import { deleteMedia } from '@/lib/media';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; mediaId: string }> }
) {
  try {
    const admin = await requireAdminWith2FA(req);
    const { id: postId, mediaId } = await params;

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
