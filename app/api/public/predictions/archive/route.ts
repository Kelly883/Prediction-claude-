import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, publicLimiter } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';
import { noStoreHeaders } from '@/lib/headers';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await checkRateLimit(publicLimiter, 'public:predictions:archive');

    const posts = await prisma.predictionPost.findMany({
      where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        scheduledAt: true,
        outcome: true,
        updatedAt: true,
        items: {
          select: {
            match: true,
            prediction: true,
          },
        },
      },
    });

    const res = NextResponse.json(posts);
    res.headers.set('Cache-Control', 'public, max-age=300, s-maxage=600');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
