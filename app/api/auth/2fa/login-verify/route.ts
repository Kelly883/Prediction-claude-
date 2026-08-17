import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyTwoFactorChallengeToken, issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { verifyTotpCode } from '@/lib/twofactor';
import { errorResponse, ApiError } from '@/lib/rbac';
import { touchSession } from '@/lib/sessions';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';
import { writeAudit } from '@/lib/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

async function verifyRecoveryCode(userId: string, rawCode: string): Promise<boolean> {
  const codeHash = crypto.createHash('sha256').update(rawCode.toUpperCase()).digest('hex');
  const record = await prisma.twoFactorRecoveryCode.findFirst({
    where: { userId, codeHash, usedAt: null },
  });
  if (!record) return false;

  await prisma.twoFactorRecoveryCode.update({
    where: { id: record.id },
    data: { usedAt: new Date() },
  });
  return true;
}

/** Step 2 of login for 2FA-enabled accounts — exchanges challengeToken + a valid TOTP code or recovery code for real session cookies. */
export async function POST(req: NextRequest) {
  try {
    const { challengeToken, code } = await req.json();
    const challenge = await verifyTwoFactorChallengeToken(challengeToken);
    if (!challenge) throw new ApiError(401, 'Login challenge expired — log in again');

    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, [ip, `user:${challenge.sub}`]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: challenge.sub } });
    if (user.deletedAt) throw new ApiError(403, 'Account has been deactivated');

    let valid = false;
    let method = 'totp';

    if (user.twoFactorSecret && code && verifyTotpCode(user.twoFactorSecret, code)) {
      valid = true;
    } else if (code && (await verifyRecoveryCode(user.id, code))) {
      valid = true;
      method = 'recovery_code';
    }

    if (!valid) {
      await writeAudit({ actorId: user.id, action: 'auth.2fa_failed', metadata: { stage: 'login_verify' } });
      throw new ApiError(400, 'Invalid code');
    }

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id);
    await touchSession(user.id, req);

    if (user.role === 'admin') {
      await writeAudit({ actorId: user.id, action: 'auth.admin_login', metadata: { via: `2fa_${method}` } });
    }

    const res = NextResponse.json({ id: user.id, email: user.email, role: user.role });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
