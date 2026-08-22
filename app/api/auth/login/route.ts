import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { issueAccessToken, issueRefreshToken, issueTwoFactorChallengeToken, cookieOptions } from '@/lib/auth';
import { verifyPassword, hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { touchSession, getDistinctDeviceCount, isAnomalous } from '@/lib/sessions';
import { LoginSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';
import { getRequestId } from '@/lib/request-id';
import { createRefreshSession, hashRefreshToken } from '@/lib/refresh-sessions';

export const runtime = 'nodejs';

const PASSWORD_REHASH_COST = 12;
const MAX_FAILED_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

function isLocked(lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return lockedUntil > new Date();
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  try {
    const rawBody = await req.json();
    const { email, password } = LoginSchema.parse(rawBody);

    const normalizedEmail = email.trim().toLowerCase();
    const ip = getClientIp(req);
    const emailIdentifier = normalizeIdentifier('email', normalizedEmail);

    // Dual rate-limiting: Rate limits both the client IP and the normalized email/account
    // to prevent distributed credential stuffing and IP rotation attacks.
    // Auth limiter is strictly fail-closed (returns 503 if Redis is unreachable).
    const allowed = await checkRateLimit(authLimiter, [ip, emailIdentifier]);
    if (!allowed) {
      return withRequestId(req, NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 }));
    }

    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });

    if (user?.deletedAt) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.login_soft_deleted',
        metadata: { requestId, ip, emailNormalized: normalizedEmail },
      });
      throw new ApiError(403, 'Account has been deactivated');
    }

    if (user && isLocked(user.lockedUntil)) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.login_locked',
        metadata: { requestId, ip, emailNormalized: normalizedEmail, lockedUntil: user.lockedUntil?.toISOString() },
      });
      return withRequestId(req, NextResponse.json(
        { error: `Account locked due to too many failed attempts. Try again later.` },
        { status: 403 }
      ));
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
        metadata: { requestId, ip, emailNormalized: normalizedEmail },
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
      return withRequestId(req, NextResponse.json({ requiresTwoFactor: true, challengeToken }));
    }

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id, user.tokenVersion);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await createRefreshSession({
      userId: user.id,
      tokenHash: refreshTokenHash,
      tokenVersion: user.tokenVersion,
      familyId: undefined,
      ip,
    });

    await touchSession(user.id, req);

    const deviceCount = await getDistinctDeviceCount(user.id);
    const existingSessions = await prisma.userSession.findMany({ where: { userId: user.id } });
    const isNewDevice = deviceCount === 1 && existingSessions.length <= 1;

    if (await isAnomalous(user.id)) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.suspicious_login',
        metadata: { requestId, ip, reason: 'device_anomaly_threshold_reached', distinctDevices: deviceCount },
      });
    }

    if (isNewDevice) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.new_device_login',
        metadata: { requestId, ip },
      });
    }

    if (user.role === 'admin') {
      await writeAudit({
        actorId: user.id,
        action: 'auth.admin_login',
        metadata: { requestId, ip, distinctDevices: deviceCount },
      });
    }

    const res = withRequestId(req, NextResponse.json({ id: user.id, email: user.email, role: user.role }));
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}

function withRequestId(req: NextRequest, res: NextResponse): NextResponse {
  const requestId = getRequestId(req);
  res.headers.set('x-request-id', requestId);
  return res;
}