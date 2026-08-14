import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canView, toTeaser } from '@/lib/entitlement';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireUser(req);
    const { id } = await params;

    const post = await prisma.predictionPost.findUnique({
      where: { id },
      include: { items: true, media: true },
    });
    if (!post) throw new ApiError(404, 'Not found');

    const allowed = await canView(user.sub, post);
    if (!allowed) return NextResponse.json(toTeaser(post, (post.items ?? []).length));

    // Full payload — booking code, items, and media asset IDs (the client
    // fetches signed URLs for those separately via /api/media/:id/signed-url,
    // which re-checks entitlement independently).
    return NextResponse.json({ ...post, locked: false });
  } catch (err) {
    return errorResponse(err);
  }
}
