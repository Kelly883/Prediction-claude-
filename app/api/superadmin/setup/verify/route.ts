import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { ApiError, errorResponse } from '@/lib/rbac';
import { verifyTotpCode } from '@/lib/twofactor';
import { writeAudit } from '@/lib/audit';
import { checkRateLimit, bootstrapLimiter, getClientIp } from '@/lib/ratelimit';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { consumePending, hasSuperAdmin } from '@/lib/superadmin-setup';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);

    if (await hasSuperAdmin()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const ip = getClientIp(req);
    const allowed = await checkRateLimit(bootstrapLimiter, [ip]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const id = req.nextUrl.searchParams.get('id');
    const pending = consumePending(id || '');
    if (!pending) {
      throw new ApiError(400, 'Bootstrap session expired or not found. Start again.');
    }

    const { code } = (await req.json()) as { code?: string };
    if (!code || code.length !== 6) {
      throw new ApiError(400, 'Enter the 6-digit code from your authenticator app');
    }

    if (!verifyTotpCode(pending.encryptedSecret, code)) {
      await writeAudit({
        actorId: 'bootstrap',
        action: 'auth.2fa_failed',
        metadata: { stage: 'bootstrap', email: pending.email, ip },
      });
      throw new ApiError(400, 'Invalid code');
    }

    const user = await prisma.user.create({
      data: {
        name: pending.name,
        email: pending.email,
        passwordHash: pending.passwordHash,
        country: 'Nigeria',
        role: 'superadmin',
        twoFactorSecret: pending.encryptedSecret,
        twoFactorEnabled: true,
        permissions: [],
        grantedBy: 'system',
        grantedAt: new Date(),
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        twoFactorEnabled: true,
        createdAt: true,
      },
    });

    await writeAudit({
      actorId: user.id,
      action: 'auth.superadmin_created',
      targetId: user.id,
      metadata: { email: user.email, ip },
    });

    return NextResponse.json({ ok: true, user });
  } catch (err) {
    return errorResponse(err);
  }
}
