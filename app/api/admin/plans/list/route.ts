import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const admin = await requireAdmin(req);
    const plans = await prisma.plan.findMany({
      where: { createdById: admin.sub },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json(plans);
  } catch (err) {
    return errorResponse(err);
  }
}
