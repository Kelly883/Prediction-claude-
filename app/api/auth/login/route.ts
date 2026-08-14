import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { issueAccessToken, issueRefreshToken, issueTwoFactorChallengeToken, cookieOptions } from '@/lib/auth';
import { verifyPassword } from '@/lib/password';
import { checkRateLimit, authLimiter } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { touchSession } from '@/lib/sessions';
import { LoginSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    if (!(await checkRateLimit(authLimiter, ip))) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const { email, password } = LoginSchema.parse(await req.json());
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, 'Invalid credentials');
    }

    // Step 1 of 2 for accounts with 2FA enabled: don't issue real session
    // tokens yet, just a short-lived challenge token identifying who's
    // completing the second step at /api/auth/2fa/login-verify.
    if (user.twoFactorEnabled) {
      const challengeToken = await issueTwoFactorChallengeToken(user.id);
      return NextResponse.json({ requiresTwoFactor: true, challengeToken });
    }

    const accessToken = await issueAccessToken({ sub: user.id, role: user.role });
    const refreshToken = await issueRefreshToken(user.id);

    await touchSession(user.id, req);

    const res = NextResponse.json({ id: user.id, email: user.email, role: user.role });
    res.cookies.set('access_token', accessToken, cookieOptions(15 * 60));
    res.cookies.set('refresh_token', refreshToken, cookieOptions(7 * 24 * 60 * 60));
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
