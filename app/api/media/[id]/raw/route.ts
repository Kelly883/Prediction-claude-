import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { getMediaBuffer } from '@/lib/media';
import { prisma } from '@/lib/prisma';
import { canView } from '@/lib/entitlement';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;

    const asset = await prisma.mediaAsset.findUnique({ where: { id } });
    if (!asset) {
      return NextResponse.json({ error: 'Media not found' }, { status: 404 });
    }

    const post = await prisma.predictionPost.findUnique({ where: { id: asset.postId } });
    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const allowed = await canView(user.sub, post);
    if (!allowed) {
      return NextResponse.json({ error: 'Not authorized to view this media' }, { status: 403 });
    }

    const { buffer, mimeType } = await getMediaBuffer(id);

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': mimeType,
        'Content-Length': buffer.length.toString(),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
