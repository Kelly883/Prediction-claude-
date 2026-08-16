import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const action = req.nextUrl.searchParams.get('action') ?? undefined;
    const { page, pageSize, offset } = parsePagination(req);

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: action ? { action } : undefined,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { actor: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where: action ? { action } : undefined }),
    ]);

    const res = NextResponse.json(logs);
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
