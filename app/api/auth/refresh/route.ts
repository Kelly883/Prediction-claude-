import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyRefreshToken, issueAccessToken, issueRefreshToken, cookieOptions } from '@/lib/auth';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { requireCsrf } from '@/lib/csrf';
import {
  hashRefreshToken,
  validateRefreshSession,
  revokeRefreshSession,
  createRefreshSession,
  handleRefreshTokenReuse,
} from '@/lib/refresh-sessions';

export const runtime = 'nodejs';

const SESSION_IDLE_TIMEOUT_MS = Number(process.env.SESSION_IDLE_TIMEOUT_MS ?? 86400000);

export async function POST(req: NextRequest) {
  try {
    requireCsrf(req);
    const token = req.cookies.get('refresh_token')?.value;
    if (!token) throw new ApiError(401, 'No refresh token');

    const payload = await verifyRefreshToken(token);
    if (!payload) throw new ApiError(401, 'Refresh token invalid or expired');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user || user.deletedAt) throw new ApiError(401, 'User no longer exists');

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

    const tokenHash = hashRefreshToken(token);
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    const userAgent = req.headers.get('user-agent') ?? undefined;

    const existingSession = await validateRefreshSession(user.id, tokenHash, user.tokenVersion);
    if (!existingSession) {
      if (payload.familyId) {
        await handleRefreshTokenReuse(user.id, payload.familyId, ip);
      } else {
        await writeAudit({
          actorId: user.id,
          action: 'auth.refresh_token_reuse',
          metadata: { reason: 'token_not_found_or_revoked', ip },
        });
      }
      throw new ApiError(401, 'Session revoked. Please log in again.');
    }

    const familyId = existingSession.familyId;
    await revokeRefreshSession(existingSession.id);

    const newRefreshToken = await issueRefreshToken(user.id, user.tokenVersion, familyId);
    const newTokenHash = hashRefreshToken(newRefreshToken);

    await createRefreshSession({
      userId: user.id,
      tokenHash: newTokenHash,
      tokenVersion: user.tokenVersion,
      familyId,
      ip,
      userAgent,
    });

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', newRefreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
