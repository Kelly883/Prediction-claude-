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

    const allUsers = await prisma.user.findMany({
      where: { role: 'user' },
      select: SAFE_USER_FIELDS,
      orderBy: { createdAt: 'desc' },
    });

    const activeSubs = await prisma.subscription.findMany({
      where: { status: 'active', endAt: { gt: new Date() } },
      select: { userId: true, endAt: true },
      orderBy: { endAt: 'desc' },
    });

    const subMap = new Map<string, Date>();
    for (const sub of activeSubs) {
      if (!subMap.has(sub.userId)) {
        subMap.set(sub.userId, sub.endAt);
      }
    }

    const enriched = allUsers.map((u) => {
      const expiresAt = subMap.get(u.id);
      return {
        ...u,
        isPaid: Boolean(expiresAt),
        expiresAt: expiresAt ? expiresAt.toISOString() : null,
      };
    });

    if (!status) return NextResponse.json(enriched);

    const filtered = status === 'paid' ? enriched.filter((u) => u.isPaid) : enriched.filter((u) => !u.isPaid);
    return NextResponse.json(filtered);
  } catch (err) {
    return errorResponse(err);
  }
}
