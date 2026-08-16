import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { redactPayload } from '@/lib/redact-payload';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const payments = await prisma.transaction.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' } });
    const safe = payments.map((tx) => ({ ...tx, rawPayload: redactPayload(tx.rawPayload) }));
    return NextResponse.json(safe, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (err) {
    return errorResponse(err);
  }
}
