import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const action = req.nextUrl.searchParams.get('action') ?? undefined;
    const logs = await prisma.auditLog.findMany({
      where: action ? { action } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: { actor: { select: { email: true } } },
    });
    return NextResponse.json(logs);
  } catch (err) {
    return errorResponse(err);
  }
}
