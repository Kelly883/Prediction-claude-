import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse, ApiError } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.auditLogs);
    const action = req.nextUrl.searchParams.get('action') ?? undefined;
    const category = req.nextUrl.searchParams.get('category') ?? undefined;
    const search = req.nextUrl.searchParams.get('search')?.trim().toLowerCase() ?? undefined;
    const dateFrom = req.nextUrl.searchParams.get('dateFrom') ?? undefined;
    const dateTo = req.nextUrl.searchParams.get('dateTo') ?? undefined;
    const { page, pageSize, offset } = parsePagination(req);

    const where: any = {};
    if (action) {
      const safeAction = String(action).replace(/[^a-zA-Z0-9._-]/g, '');
      if (safeAction) where.action = safeAction;
    }
    if (category) {
      const safeCategory = String(category).replace(/[^a-zA-Z0-9_-]/g, '');
      if (safeCategory) where.action = { startsWith: safeCategory + '.' };
    }
    if (search) {
      where.OR = [
        { action: { contains: search, mode: 'insensitive' } },
        { actor: { email: { contains: search, mode: 'insensitive' } } },
        { targetId: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (dateFrom || dateTo) {
      where.createdAt = {};
      if (dateFrom) {
        const from = new Date(dateFrom);
        if (isNaN(from.getTime())) throw new ApiError(400, 'Invalid dateFrom');
        where.createdAt.gte = from;
      }
      if (dateTo) {
        const to = new Date(dateTo);
        if (isNaN(to.getTime())) throw new ApiError(400, 'Invalid dateTo');
        where.createdAt.lte = new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59);
      }
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
