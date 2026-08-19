import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const { token } = await req.json();
    if (!token) {
      throw new ApiError(400, 'token is required');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      await writeAudit({
        action: 'auth.email_verification_failed',
        targetId: record?.userId,
        metadata: { reason: !record ? 'token_not_found' : record.usedAt ? 'already_used' : 'expired' },
      });
      throw new ApiError(400, 'Invalid or expired verification token');
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId } });
    if (!user || user.deletedAt) {
      throw new ApiError(400, 'Invalid verification token');
    }

    if (user.emailVerifiedAt) {
      return NextResponse.json({ message: 'Your email is already verified.', alreadyVerified: true });
    }

    await prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await db.emailVerificationToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    });

    await writeAudit({
      action: 'auth.email_verified',
      targetId: record.userId,
      metadata: { email: user.email },
    });

    return NextResponse.json({ message: 'Email verified successfully', alreadyVerified: false });
  } catch (err) {
    return errorResponse(err);
  }
}
