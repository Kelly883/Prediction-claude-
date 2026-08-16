import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse, ApiError } from '@/lib/rbac';
import { getDistinctDeviceCount, isAnomalous } from '@/lib/sessions';
import { writeAudit } from '@/lib/audit';
import { redactPayload } from '@/lib/redact-payload';

export const runtime = 'nodejs';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireAdmin(req);
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: { id: true, name: true, email: true, phone: true, country: true, role: true, twoFactorEnabled: true, createdAt: true, failedLoginAttempts: true, lockedUntil: true },
    });
    if (!user) throw new ApiError(404, 'Not found');

    const [subscriptions, transactions, deviceCount] = await Promise.all([
      prisma.subscription.findMany({ where: { userId: id }, include: { plan: true }, orderBy: { createdAt: 'desc' } }),
      prisma.transaction.findMany({ where: { userId: id }, orderBy: { createdAt: 'desc' }, take: 50 }),
      getDistinctDeviceCount(id),
    ]);

    const safeSubscriptions = subscriptions.map(({ renewalAuthCode, ...sub }) => sub);
    const safeTransactions = transactions.map((tx) => ({ ...tx, rawPayload: redactPayload(tx.rawPayload) }));

    return NextResponse.json({
      user,
      subscriptions: safeSubscriptions,
      transactions: safeTransactions,
      deviceActivity: { distinctDevicesLast24h: deviceCount, anomalous: await isAnomalous(id) },
    });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin(req);
    const { id } = await params;
    const body = await req.json();

    if (body.action === 'unlock') {
      const user = await prisma.user.findUnique({ where: { id } });
      if (!user) throw new ApiError(404, 'User not found');

      await prisma.user.update({
        where: { id },
        data: { failedLoginAttempts: 0, lockedUntil: null },
      });

      await writeAudit({
        actorId: admin.sub,
        action: 'auth.account_unlocked',
        targetId: id,
        metadata: { targetEmail: user.email },
      });

      return NextResponse.json({ ok: true, message: 'Account unlocked' });
    }

    throw new ApiError(400, 'Unsupported action');
  } catch (err) {
    return errorResponse(err);
  }
}
