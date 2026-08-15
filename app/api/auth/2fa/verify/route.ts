import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { verifyTotpCode } from '@/lib/twofactor';
import { writeAudit } from '@/lib/audit';
import { TwoFactorVerifySchema } from '@/lib/schemas';
import { checkRateLimit, authLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';

export const runtime = 'nodejs';

/** Confirms setup by requiring one valid code before flipping twoFactorEnabled on. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const userId = normalizeIdentifier('user', user.sub);

    const allowed = await checkRateLimit(authLimiter, [ip, userId]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const { code } = TwoFactorVerifySchema.parse(await req.json());

    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (!record.twoFactorSecret) throw new ApiError(400, 'Call /api/auth/2fa/setup first');

    if (!verifyTotpCode(record.twoFactorSecret, code)) {
      await writeAudit({ actorId: user.sub, action: 'auth.2fa_failed', metadata: { stage: 'setup_verify' } });
      throw new ApiError(400, 'Invalid code');
    }

    await prisma.user.update({ where: { id: user.sub }, data: { twoFactorEnabled: true } });
    await writeAudit({ actorId: user.sub, action: 'auth.2fa_enabled' });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
