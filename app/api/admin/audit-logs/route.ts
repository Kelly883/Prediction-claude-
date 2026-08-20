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

    const distinctActions = await prisma.auditLog.findMany({
      where: action ? { action } : undefined,
      select: { action: true },
      distinct: ['action'],
      orderBy: { action: 'asc' },
    });

    const availableActions = distinctActions.map((a) => a.action);

    const totalPages = Math.max(1, Math.ceil(total / pageSize));

    // Total count and the full action list are in the JSON body, not just
    // response headers — the frontend's fetch wrapper (apiJson) only ever
    // returns the parsed body and discards headers, so `X-Total` etc. were
    // being set correctly but were never actually reachable by any caller.
    // Kept the headers too for any other consumer, but the body is now the
    // real contract.
    const res = NextResponse.json({
      logs,
      total,
      page,
      pageSize,
      totalPages,
      availableActions,
    });
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
