import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyRefreshToken, issueAccessToken, cookieOptions } from '@/lib/auth';
import { errorResponse, ApiError } from '@/lib/rbac';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/**
 * Silently exchanges a valid refresh_token cookie for a new access_token.
 * This route existing at all was the actual gap: without it, every session
 * hard-logs-out after 15 minutes (JWT_ACCESS_TTL) with no recovery path.
 * The frontend should call this whenever a request comes back 401, then
 * retry the original request once — see lib/api-client.ts.
 */
export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const token = req.cookies.get('refresh_token')?.value;
    if (!token) throw new ApiError(401, 'No refresh token');

    const payload = await verifyRefreshToken(token);
    if (!payload) throw new ApiError(401, 'Refresh token invalid or expired');

    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) throw new ApiError(401, 'User no longer exists');

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });

    const res = NextResponse.json({ ok: true });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
