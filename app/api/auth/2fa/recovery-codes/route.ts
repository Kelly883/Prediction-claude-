import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';
import { writeAudit } from '@/lib/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

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
    if (!record.twoFactorEnabled) {
      throw new ApiError(400, '2FA is not enabled');
    }

    const codes: string[] = [];
    const codeHashes: string[] = [];
    for (let i = 0; i < 10; i++) {
      const rawCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      const codeHash = crypto.createHash('sha256').update(rawCode).digest('hex');
      codes.push(rawCode);
      codeHashes.push(codeHash);
    }

    await prisma.twoFactorRecoveryCode.createMany({
      data: codeHashes.map((codeHash) => ({
        userId: user.sub,
        codeHash,
      })),
    });

    await writeAudit({
      actorId: user.sub,
      action: 'auth.2fa_recovery_codes_generated',
      metadata: { count: codes.length },
    });

    return NextResponse.json({ codes });
  } catch (err) {
    return errorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });
    if (record.deletedAt) throw new ApiError(403, 'Account has been deactivated');
    if (!record.twoFactorEnabled) {
      throw new ApiError(400, '2FA is not enabled');
    }

    const remaining = await prisma.twoFactorRecoveryCode.count({
      where: { userId: user.sub, usedAt: null },
    });

    return NextResponse.json({ remaining });
  } catch (err) {
    return errorResponse(err);
  }
}
