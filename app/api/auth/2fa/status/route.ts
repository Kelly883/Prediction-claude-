import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUnique({
      where: { id: user.sub },
      select: { twoFactorEnabled: true },
    });
    if (!record) throw new Error('User not found');
    return NextResponse.json({ twoFactorEnabled: record.twoFactorEnabled });
  } catch (err) {
    return errorResponse(err);
  }
}
