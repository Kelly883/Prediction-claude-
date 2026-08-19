import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const action = req.nextUrl.searchParams.get('action') ?? undefined;
    const category = req.nextUrl.searchParams.get('category') ?? undefined;
    const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? undefined;
    const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? undefined;
    const dateTo = req.nextUrl.searchParams.get('dateTo') ?? undefined;
    const { page, pageSize, offset } = parsePagination(req);

    const where: any = {};
    if (action) where.action = action;
    if (category) where.action = { startsWith: category + '.' };
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { actor: { email: { contains: search, mode: 'insensitive' } } },
        { targetId: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) where.createdAt.gte = new Date(dateFrom);
      if (dateTo) where.createdAt.lte = new Date(dateTo + 'T23:59:59');
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { actor: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
    ]);

    const res = NextResponse.json(logs);
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
