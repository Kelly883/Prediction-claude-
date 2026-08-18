import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyRefreshToken, issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? 86400000);

/**
 * Silently exchanges a valid refresh_token cookie for a new access_token.
 * Enforces tokenVersion validity — if password reset occurred, older tokens are rejected.
 * Implements refresh token rotation: the old refresh token is marked as used
 * and a new one is issued alongside the new access token.
 * Enforces idle timeout based on userSession.lastSeenAt.
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.cookies.get('refresh_token')?.value;
    if (!token) throw new ApiError(401, 'No refresh token');

    const payload = await verifyRefreshToken(token);
    if (!payload) throw new ApiError(401, 'Refresh token invalid or expired');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) throw new ApiError(401, 'User no longer exists');

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

    const sessions = await prisma.userSession.findMany({
      where: { userId: user.id },
      orderBy: { lastSeenAt: 'desc' },
    });

    if (sessions.length > 0) {
      const mostRecent = sessions[0].lastSeenAt;
      if (mostRecent.getTime() + SESSION_IDLE_TIMEOUT_MS < Date.now()) {
        const res = NextResponse.json({ error: 'Session expired due to inactivity. Please log in again.' }, { status: 401 });
        res.cookies.delete('access_token');
        res.cookies.delete('refresh_token');
        return res;
      }

      await prisma.userSession.updateMany({
        where: { userId: user.id },
        data: { lastSeenAt: new Date() },
      });
    }

    // Refresh token rotation: mark the old jti as used to prevent reuse
    if (payload.jti) {
      const { usedRefreshJtis } = await import('@/lib/auth');
      usedRefreshJtis.add(payload.jti);
    }

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const newRefreshToken = await issueRefreshToken(user.id, user.tokenVersion);

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', newRefreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
