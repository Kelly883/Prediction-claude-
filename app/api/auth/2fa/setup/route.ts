import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { generateSecret, generateOtpAuthUri } from '@/lib/twofactor';
import { encryptTotpSecret } from '@/lib/encryption';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

/**
 * Generates a new TOTP secret and stores its ciphertext, but leaves twoFactorEnabled
 * false until the user proves they can actually generate a valid code at
 * /api/auth/2fa/verify — this stops someone from enabling 2FA against a
 * secret they never successfully saved into their authenticator app and
 * locking themselves out immediately.
 *
 * Plaintext secret is returned ONCE during setup to populate authenticator apps/QR codes.
 */
export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, [ip, `user:${user.sub}`]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (record.deletedAt) throw new ApiError(403, 'Account has been deactivated');

    const secret = generateSecret();
    let encryptedSecret: string;
    try {
      encryptedSecret = encryptTotpSecret(secret);
    } catch (encryptErr) {
      const reason = encryptErr instanceof Error ? encryptErr.message : 'TOTP encryption is not configured';
      await writeAudit({
        actorId: user.sub,
        action: 'auth.2fa_setup_failed',
        metadata: { reason, ip },
      });
      throw new ApiError(500, '2FA setup is currently unavailable. Please contact support.');
    }

    await prisma.user.update({
      where: { id: user.sub },
      data: { twoFactorSecret: encryptedSecret, twoFactorEnabled: false },
    });

    const otpauthUri = generateOtpAuthUri(secret, record.email);
    return NextResponse.json({ secret, otpauthUri });
  } catch (err) {
    return errorResponse(err);
  }
}
