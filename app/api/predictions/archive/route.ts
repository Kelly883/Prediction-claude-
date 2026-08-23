import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { canView, toTeaser } from '@/lib/entitlement';
import { requireUser, errorResponse } from '@/lib/rbac';
import { checkRateLimit, defaultLimiter } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!(await checkRateLimit(defaultLimiter, user.sub))) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const posts = await prisma.predictionPost.findMany({
      where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
      orderBy: { updatedAt: 'desc' },
      include: { items: true },
    });

    const result = await Promise.all(
      posts.map(async (post) => {
        const allowed = await canView(user.sub, post);
        if (!allowed) return toTeaser(post, (post.items ?? []).length);
        return { ...post, locked: false };
      }),
    );

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
