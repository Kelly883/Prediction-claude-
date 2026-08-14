import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const payments = await prisma.transaction.findMany({ where: { userId: user.sub }, orderBy: { createdAt: 'desc' } });
    return NextResponse.json(payments);
  } catch (err) {
    return errorResponse(err);
  }
}
