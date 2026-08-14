import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const sub = await prisma.subscription.findFirst({
      where: { userId: user.sub, status: 'active' },
      orderBy: { endAt: 'desc' },
      include: { plan: true },
    });
    return NextResponse.json(sub);
  } catch (err) {
    return errorResponse(err);
  }
}
