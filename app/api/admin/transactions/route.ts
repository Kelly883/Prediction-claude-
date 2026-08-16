import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';
import { redactPayload } from '@/lib/payments';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') as 'pending' | 'success' | 'failed' | null;
    const transactions = await prisma.transaction.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });

    const safe = transactions.map((tx) => ({
      ...tx,
      rawPayload: redactPayload(tx.rawPayload),
    }));

    return NextResponse.json(safe);
  } catch (err) {
    return errorResponse(err);
  }
}
