import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyRefreshToken, issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const MAX_ACTIVE_SESSIONS = 5;

/**
 * Silently exchanges a valid refresh_token cookie for a new access_token.
 * Enforces tokenVersion validity — if password reset occurred, older tokens are rejected.
 * Implements refresh token rotation: each use invalidates all other refresh tokens.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('refresh_token')?.value;
    if (!token) throw new ApiError(401, 'No refresh token');

    const payload = await verifyRefreshToken(token);
    if (!payload) throw new ApiError(401, 'Refresh token invalid or expired');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError(401, 'User no longer exists');

    // Token version check: If token version in token does not match user's current version
    // (e.g. after a password reset), reject and log security event.
    if (payload.tv !== undefined && payload.tv !== user.tokenVersion) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.refresh_token_reuse',
        metadata: { expectedVersion: user.tokenVersion, providedVersion: payload.tv },
      });
      throw new ApiError(401, 'Session revoked. Please log in again.');
    }

    // Refresh token rotation: check rv matches current refreshTokenVersion.
    // On mismatch, reject (stale or reused token).
    if (payload.rv !== undefined && payload.rv !== user.refreshTokenVersion) {
      await writeAudit({
        actorId: user.id,
        action: 'auth.refresh_token_reuse',
        metadata: { expectedRv: user.refreshTokenVersion, providedRv: payload.rv },
      });
      throw new ApiError(401, 'Session revoked. Please log in again.');
    }

    // Enforce max concurrent sessions: if user has too many active sessions,
    // remove stale ones before issuing a new token.
    const activeSessionCount = await prisma.userSession.count({ where: { userId: user.id } });
    if (activeSessionCount >= MAX_ACTIVE_SESSIONS) {
      const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
      await prisma.userSession.deleteMany({
        where: { userId: user.id, lastSeenAt: { lt: cutoff } },
      });
      const remainingCount = await prisma.userSession.count({ where: { userId: user.id } });
      if (remainingCount >= MAX_ACTIVE_SESSIONS) {
        throw new ApiError(403, 'Too many active sessions. Please log out from another device.');
      }
    }

    // Increment refreshTokenVersion to invalidate all other refresh tokens
    // (rotation). Issue new access + refresh tokens.
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { refreshTokenVersion: { increment: 1 } },
    });

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id, user.tokenVersion, updatedUser.refreshTokenVersion);

    await writeAudit({
      actorId: user.id,
      action: 'auth.token_refreshed',
      metadata: { refreshedRv: updatedUser.refreshTokenVersion },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
