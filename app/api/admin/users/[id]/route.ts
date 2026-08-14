import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { getDistinctDeviceCount, isAnomalous } from '@/lib/sessions';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true, country: true, role: true, twoFactorEnabled: true, createdAt: true },
    });
    if (!user) throw new ApiError(404, 'Not found');

    const [subscriptions, transactions, deviceCount] = await Promise.all([
      prisma.subscription.findMany({ where: { userId: id }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      prisma.transaction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      getDistinctDeviceCount(id),
    ]);

    return NextResponse.json({
      user,
      subscriptions,
      transactions,
      deviceActivity: { distinctDevicesLast24h: deviceCount, anomalous: await isAnomalous(id) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
