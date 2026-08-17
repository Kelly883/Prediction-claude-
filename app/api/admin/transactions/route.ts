import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { redactPayload } from '@/lib/payments';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') as 'pending' | 'success' | 'failed' | null;
    const { page, pageSize, offset } = parsePagination(req);

    const [transactions, total] = await Promise.all([
      prisma.transaction.findMany({
        where: status ? { status } : undefined,
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
