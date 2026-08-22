import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { page, pageSize, offset } = parsePagination(req);

    const [sessions, total] = await Promise.all([
      prisma.userSession.findMany({
        where: { userId: user.sub },
        orderBy: { lastSeenAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      prisma.userSession.count({ where: { userId: user.sub } }),
    ]);

    const res = NextResponse.json(sessions, { headers: { 'Cache-Control': 'private, no-store' } });
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
