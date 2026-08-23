import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.predictions);
    const { page, pageSize, offset } = parsePagination(req);

    const posts = await prisma.predictionPost.findMany({
      where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
      orderBy: { updatedAt: 'desc' },
      include: { items: true, media: true },
      skip: offset,
      take: pageSize,
    });

    const total = await prisma.predictionPost.count({
      where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
    });

    const res = NextResponse.json(posts);
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
