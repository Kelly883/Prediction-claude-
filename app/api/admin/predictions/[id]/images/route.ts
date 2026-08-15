import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { uploadMedia, MAX_IMAGE_UPLOAD_BYTES } from '@/lib/media';
import { writeAudit } from '@/lib/audit';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, imageUploadLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs'; // sharp requires the Node runtime

const MAX_IMAGES_PER_PREDICTION = 10;

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id: postId } = await params;
    const media = await prisma.mediaAsset.findMany({
      where: { postId },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({ success: true, data: media });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);

    // Rate-limiting check: max 20 uploads / min per admin
    if (!(await checkRateLimit(imageUploadLimiter, admin.sub))) {
      return NextResponse.json(
        { error: 'Too many upload attempts. Please try again later.' },
        { status: 429 }
      );
    }

    // CSRF defense: Origin / Referer check
    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin && host) {
      try {
        const originHost = new URL(origin).host;
        if (originHost !== host) {
          return NextResponse.json({ error: 'Forbidden cross-origin upload request.' }, { status: 403 });
        }
      } catch {
        return NextResponse.json({ error: 'Invalid origin header.' }, { status: 403 });
      }
    }

    const { id: postId } = await params;

    // Check existing image count quota for this prediction post
    const existingCount = await prisma.mediaAsset.count({ where: { postId } });
    if (existingCount >= MAX_IMAGES_PER_PREDICTION) {
      return NextResponse.json(
        { error: `Maximum of ${MAX_IMAGES_PER_PREDICTION} images reached for this prediction post.` },
        { status: 400 }
      );
    }

    const contentLength = req.headers.get('content-length');
    if (contentLength && parseInt(contentLength, 10) > MAX_IMAGE_UPLOAD_BYTES + 1024 * 1024) {
      return NextResponse.json(
        { error: 'Image must not exceed 5 MB.' },
        { status: 413 }
      );
    }

    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      return NextResponse.json({ error: 'Malformed request or invalid multipart data.' }, { status: 400 });
    }

    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'Image file is required.' }, { status: 400 });
    }

    if (file.size > MAX_IMAGE_UPLOAD_BYTES) {
      return NextResponse.json(
        { error: 'Image must not exceed 5 MB.' },
        { status: 413 }
      );
    }

    const asset = await uploadMedia(postId, file);

    await writeAudit({
      actorId: admin.sub,
      action: 'prediction.image_upload',
      targetId: postId,
      metadata: {
        mediaId: asset.id,
        storageKey: asset.storageKey,
        mimeType: asset.mimeType,
        width: asset.width,
        height: asset.height,
        size: asset.size,
        sha256: asset.sha256,
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Prediction image uploaded successfully.',
      data: {
        id: asset.id,
        url: asset.url,
        mime_type: asset.mimeType,
        mimeType: asset.mimeType,
        size: asset.size,
        width: asset.width,
        height: asset.height,
        sha256: asset.sha256,
        storageKey: asset.storageKey,
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

