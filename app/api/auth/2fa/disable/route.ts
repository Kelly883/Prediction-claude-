import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { verifyPassword } from '@/lib/password';
import { verifyTotpCode } from '@/lib/twofactor';
import { writeAudit } from '@/lib/audit';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, [ip, `user:${user.sub}`]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const { password, code } = await req.json();

    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (!record.twoFactorEnabled) {
      throw new ApiError(400, '2FA is not enabled on this account');
    }

    // Require either password or valid TOTP code to disable 2FA
    const isPasswordValid = password ? await verifyPassword(password, record.passwordHash) : false;
    const isCodeValid = code && record.twoFactorSecret ? verifyTotpCode(record.twoFactorSecret, code) : false;

    if (!isPasswordValid && !isCodeValid) {
      await writeAudit({
        actorId: user.sub,
        action: 'auth.2fa_failed',
        metadata: { stage: 'disable_attempt' },
      });
      throw new ApiError(401, 'Valid current password or authenticator code is required to disable 2FA');
    }

    await prisma.user.update({
      where: { id: user.sub },
      data: { twoFactorEnabled: false, twoFactorSecret: null },
    });

    await writeAudit({
      actorId: user.sub,
      action: 'auth.2fa_disabled',
    });

    return NextResponse.json({ ok: true, message: '2FA has been disabled' });
  } catch (err) {
    return errorResponse(err);
  }
}
