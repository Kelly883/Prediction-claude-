import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { generateSecret, generateOtpAuthUri } from '@/lib/twofactor';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/**
 * Generates a new TOTP secret and stores it, but leaves twoFactorEnabled
 * false until the user proves they can actually generate a valid code at
 * /api/auth/2fa/verify — this stops someone from enabling 2FA against a
 * secret they never successfully saved into their authenticator app and
 * locking themselves out immediately.
 */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const userId = normalizeIdentifier('user', user.sub);

    const allowed = await checkRateLimit(authLimiter, [ip, userId]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });

    const secret = generateSecret();
    await prisma.user.update({ where: { id: user.sub }, data: { twoFactorSecret: secret, twoFactorEnabled: false } });

    const otpauthUri = generateOtpAuthUri(secret, record.email);
    // No QR image generated server-side to avoid an extra dependency —
    // the frontend renders `otpauthUri` as a QR code client-side, or the
    // user can enter `secret` manually into their authenticator app.
    return NextResponse.json({ secret, otpauthUri });
  } catch (err) {
    return errorResponse(err);
  }
}
