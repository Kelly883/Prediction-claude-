import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, publicLimiter } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await checkRateLimit(publicLimiter, 'public:predictions:archive');

    const posts = await prisma.predictionPost.findMany({
      where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
      orderBy: { updatedAt: 'desc' },
      include: { items: true },
    });

    return NextResponse.json(posts);
  } catch (err) {
    return errorResponse(err);
  }
}
