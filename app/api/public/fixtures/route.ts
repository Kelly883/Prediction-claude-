import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, publicLimiter } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await checkRateLimit(publicLimiter, 'public:fixtures');

    const now = new Date();

    const posts = await prisma.predictionPost.findMany({
      where: {
        status: { in: ['published', 'scheduled'] },
        scheduledAt: { gt: now },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 12,
      include: {
        items: {
          orderBy: { matchDateTime: 'asc' },
          take: 6,
        },
      },
    });

    const fixtures = posts.map((post) => ({
      id: post.id,
      title: post.title,
      scheduledAt: post.scheduledAt,
      status: post.status,
      matchCount: post.items.length,
      items: post.items.map((item) => ({
        id: item.id,
        match: item.match,
        matchDateTime: item.matchDateTime,
      })),
    }));

    const res = NextResponse.json({ fixtures });
    res.headers.set('Cache-Control', 'public, max-age=120, s-maxage=300');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
