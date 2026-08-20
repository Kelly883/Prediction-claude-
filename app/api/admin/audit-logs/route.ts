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

    // availableActions is intentionally unfiltered (whole table, not `where`)
    // — it populates the Action filter dropdown itself, so it must list
    // every action that has EVER been logged, not just the ones on the
    // current page/filtered view. Previously this dropdown was built from
    // `logs` (the current page only), so an action that only ever occurred
    // on page 3 was literally unselectable while looking at page 1.
    const [logs, total, distinctActions] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { actor: { select: { email: true } } },
      }),
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({ distinct: ['action'], select: { action: true }, orderBy: { action: 'asc' } }),
    ]);

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
      availableActions: distinctActions.map((a) => a.action),
    });
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
