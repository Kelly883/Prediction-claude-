import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { uploadMedia } from '@/lib/media';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, adminLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs'; // sharp requires the Node runtime

const MAX_IMAGES_PER_POST = 10;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const admin = await requireAdmin(req);
    const ip = getClientIp(req);

    // CSRF defense: verify origin/host if origin is provided
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          throw new ApiError(403, 'Forbidden cross-origin upload request.');
        }
      } catch (urlErr) {
        if (urlErr instanceof ApiError) throw urlErr;
        throw new ApiError(403, 'Forbidden cross-origin upload request.');
      }
    }

    const allowed = await checkRateLimit(adminLimiter, ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many upload attempts, try again shortly.' }, { status: 429 });
    }

    const { id: postId } = await params;

    // Check image quota per post
    if (prisma?.mediaAsset?.count) {
      const existingCount = await prisma.mediaAsset.count({ where: { postId } });
      if (existingCount >= MAX_IMAGES_PER_POST) {
        return NextResponse.json(
          { error: `Maximum of ${MAX_IMAGES_PER_POST} images reached for this prediction.` },
          { status: 400 },
        );
      }
    }

    const formData = await req.formData();
    const file = formData.get('file') as File | null;
    if (!file) {
      throw new ApiError(400, 'Image file is required.');
    }

    const asset = await uploadMedia(postId, file);
    await writeAudit({
      actorId: admin.sub,
      action: 'prediction.image_upload',
      targetId: postId,
      metadata: { mediaId: asset.id },
    });

    return NextResponse.json({
      success: true,
      message: 'Prediction image uploaded successfully.',
      data: {
        id: asset.id,
        postId,
        url: (asset as any).url ?? `/api/media/${asset.id}`,
        storageKey: asset.storageKey,
        mime_type: (asset as any).mimeType ?? file.type,
        width: (asset as any).width ?? 100,
        height: (asset as any).height ?? 100,
        size: file.size,
        sha256: (asset as any).sha256 ?? '',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
