import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { issueAccessToken, issueRefreshToken, issueTwoFactorChallengeToken, cookieOptions } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { touchSession, isAnomalous } from '@/lib/sessions';
import { LoginSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const PASSWORD_REHASH_COST = 12;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;
const MAX_ACTIVE_SESSIONS = 5;

function isLocked(lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return lockedUntil > new Date();
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json();
    const { email, password } = LoginSchema.parse(rawBody);

    const ip = getClientIp(req);
    const emailIdentifier = normalizeIdentifier('email', email);

    // Dual rate-limiting: Rate limits both the client IP and the normalized email/account
    // to prevent distributed credential stuffing and IP rotation attacks.
    // Auth limiter is strictly fail-closed (returns 503 if Redis is unreachable).
    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const user = await prisma.user.findUnique({ where: { email } });

    if (user && isLocked(user.lockedUntil)) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.login_locked',
        metadata: { ip, emailNormalized: email.toLowerCase(), lockedUntil: user.lockedUntil?.toISOString() },
      });
      return NextResponse.json(
        { error: `Account locked due to too many failed attempts. Try again later.` },
        { status: 403 }
      );
    }

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      if (user) {
        const newAttempts = user.failedLoginAttempts + 1;
        const updates: any = { failedLoginAttempts: newAttempts };

        if (newAttempts >= MAX_FAILED_LOGIN_ATTEMPTS) {
          updates.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000);
        }

        await prisma.user.update({ where: { id: user.id }, data: updates });
      }

      await writeAudit({
        actorId: user?.id ?? null,
        action: 'auth.login_failure',
        metadata: { ip, emailNormalized: email.toLowerCase() },
      });
      throw new ApiError(401, 'Invalid credentials');
    }

    // Reset lockout state on successful authentication
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginAttempts: 0, lockedUntil: null },
    });

    // Password rehash: if the stored hash was created with a lower cost factor,
    // rehash with the current default so that password security improves over time
    // without forcing a reset.
    const hashCostMatch = user.passwordHash.match(/\$(\d+)\$/);
    const hashCost = hashCostMatch ? parseInt(hashCostMatch[1], 10) : 0;

    if (hashCost < PASSWORD_REHASH_COST) {
      const newHash = await hashPassword(password);
      await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });
    }

    // Step 1 of 2 for accounts with 2FA enabled: don't issue real session
    // tokens yet, just a short-lived challenge token identifying who's
    // completing the second step at /api/auth/2fa/login-verify.
    if (user.twoFactorEnabled) {
      const challengeToken = await issueTwoFactorChallengeToken(user.id);
      return NextResponse.json({ requiresTwoFactor: true, challengeToken });
    }

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id, user.tokenVersion, user.refreshTokenVersion);

    const activeSessionCount = await prisma.userSession.count({ where: { userId: user.id } });
    if (activeSessionCount >= MAX_ACTIVE_SESSIONS) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.userSession.deleteMany({
        where: { userId: user.id, lastSeenAt: { lt: cutoff } },
      });
    }

    await touchSession(user.id, req);

    if (await isAnomalous(user.id)) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.suspicious_login',
        metadata: { ip, reason: 'device_anomaly_threshold_reached' },
      });
    }

    if (user.role === 'admin') {
      await writeAudit({
        actorId: user.id,
        action: 'auth.admin_login',
        metadata: { ip },
      });
    }

    const res = NextResponse.json({ id: user.id, email: user.email, role: user.role });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}