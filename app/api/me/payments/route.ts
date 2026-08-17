import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { redactPayload } from '@/lib/payments';
import { parsePagination, withPaginationHeaders } from '@/lib/pagination';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { page, pageSize, offset } = parsePagination(req);

    const [payments, total] = await Promise.all([
      prisma.transaction.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' }, skip: offset, take: pageSize }),
      prisma.transaction.count({ where: { userId: user.sub } }),
    ]);

    const safe = payments.map((tx) => ({
      ...tx,
      rawPayload: redactPayload(tx.rawPayload),
    }));

    const res = NextResponse.json(safe, { headers: { 'Cache-Control': 'private, no-store' } });
    return withPaginationHeaders(res, page, pageSize, total);
  } catch (err) {
    return errorResponse(err);
  }
}
