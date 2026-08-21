import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse } from '@/lib/rbac';
import { PERMISSIONS } from '@/lib/permissions';
import { redactPayload } from '@/lib/payments';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requirePermission(req, PERMISSIONS.pages.transactions);
    const rawStatus = req.nextUrl.searchParams.get('status');
    const status = rawStatus === 'pending' || rawStatus === 'success' || rawStatus === 'failed' ? rawStatus : null;
    const { page, pageSize, offset } = parsePagination(req);

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: status ? { status } : undefined,
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      prisma.transaction.count({ where: status ? { status } : undefined }),
    ]);

    const safe = transactions.map((tx) => ({
      ...tx,
      rawPayload: redactPayload(tx.rawPayload),
    }));

    const res = NextResponse.json(safe);
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
