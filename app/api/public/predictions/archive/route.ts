import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, publicLimiter } from '@/lib/ratelimit';
import { errorResponse } from '@/lib/rbac';
import { parsePagination } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await checkRateLimit(publicLimiter, 'public:predictions:archive');

    const { page, pageSize, offset } = parsePagination(req);
    const plan = req.nextUrl.searchParams.get('plan') || undefined;

    // Validate the requested plan against supported plan identifiers so an
    // unknown plan is rejected explicitly rather than silently returning empty.
    if (plan) {
      const knownPlan = await prisma.plan.findUnique({
        where: { id: plan },
        select: { id: true },
      });
      if (!knownPlan) {
        return NextResponse.json({ error: 'Invalid plan.' }, { status: 400 });
      }
    }

    const where: any = {
      status: 'archived',
      outcome: { in: ['won', 'lost'] },
    };

    // Only expose records that genuinely belong to the requested plan.
    // `planIds` is the authoritative per-post plan list; an empty list never
    // matches, so records with missing plan metadata never leak under another
    // plan. An unknown plan id simply yields an empty (safe) result set.
    if (plan) {
      where.planIds = { has: plan };
    }

    const [posts, total] = await Promise.all([
      prisma.predictionPost.findMany({
        where,
        orderBy: { updatedAt: 'desc' },
        skip: offset,
        take: pageSize,
        select: {
          id: true,
          title: true,
          scheduledAt: true,
          outcome: true,
          updatedAt: true,
          bookingCode: true,
          items: {
            select: {
              match: true,
              prediction: true,
            },
            orderBy: { matchDateTime: 'asc' },
          },
        },
      }),
      prisma.predictionPost.count({ where }),
    ]);

    // Explicitly shape the public response so internal fields (planIds,
    // rawPayload, analysisResult, etc.) can never leak, regardless of what the
    // underlying driver returns.
    const safePosts = posts.map((p: any) => ({
      id: p.id,
      title: p.title,
      scheduledAt: p.scheduledAt,
      outcome: p.outcome,
      updatedAt: p.updatedAt,
      bookingCode: p.bookingCode,
      items: (p.items ?? []).map((i: any) => ({
        match: i.match,
        prediction: i.prediction,
      })),
    }));

    const pageSizeFinal = Math.min(100, Math.max(1, pageSize));
    const hasMore = offset + posts.length < total;

    const res = NextResponse.json({
      posts: safePosts,
      total,
      page,
      pageSize: pageSizeFinal,
      hasMore,
    });
    res.headers.set('Cache-Control', 'public, max-age=60, s-maxage=300');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
