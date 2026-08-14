import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireAdmin, errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

// SECURITY: explicit `select` is load-bearing here, not stylistic — without
// it, Prisma returns the full row including passwordHash and
// twoFactorSecret (the raw TOTP seed; leaking it defeats 2FA entirely for
// that account). Never change this to a bare findMany() with no select.
const SAFE_USER_FIELDS = {
  id: true,
  name: true,
  email: true,
  phone: true,
  country: true,
  role: true,
  createdAt: true,
} as const;

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const status = req.nextUrl.searchParams.get('status') as 'paid' | 'unpaid' | null;

    const all = await prisma.user.findMany({ where: { role: 'user' }, select: SAFE_USER_FIELDS });
    if (!status) return NextResponse.json(all);

    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'active', endAt: { gt: new Date() } },
      select: { userId: true },
      distinct: ['userId'],
    });
    const paidIds = new Set(activeSubs.map((s) => s.userId));

    const filtered = status === 'paid' ? all.filter((u) => paidIds.has(u.id)) : all.filter((u) => !paidIds.has(u.id));
    return NextResponse.json(filtered);
  } catch (err) {
    return errorResponse(err);
  }
}
