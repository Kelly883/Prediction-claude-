import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const staleCutoff = new Date(Date.now() - 30 * 60 * 1000);
    const stalePendingCount = await prisma.transaction.count({ where: { status: 'pending', createdAt: { lt: staleCutoff } } });
    const successfulLast24h = await prisma.transaction.count({
      where: { status: 'success', createdAt: { gt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    });
    return NextResponse.json({ stalePendingCount, successfulLast24h });
  } catch (err) {
    return errorResponse(err);
  }
}
