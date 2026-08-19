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
      const reason = !record ? 'token_not_found' : record.usedAt ? 'already_used' : 'expired';
      const user = record ? await prisma.user.findUnique({ where: { id: record.userId }, select: { email: true, deletedAt: true } }) : null;
      if (user?.deletedAt) {
        await writeAudit({
          action: 'auth.email_verification_failed',
          targetId: record?.userId,
          metadata: { reason: 'account_deleted' },
        });
        return NextResponse.json({ error: 'Invalid verification token', reason: 'account_deleted' }, { status: 400 });
      }
      await writeAudit({
        action: 'auth.email_verification_failed',
        targetId: record?.userId,
        metadata: { reason },
      });
      return NextResponse.json({
        error: reason === 'expired' ? 'This verification link has expired.' : 'Invalid or already used verification token',
        reason,
        email: user?.email ?? null,
      }, { status: 400 });
    }

    const user = await prisma.user.findUnique({ where: { id: record.userId }, select: { email: true, deletedAt: true, emailVerifiedAt: true } });
    if (!user || user.deletedAt) {
      await writeAudit({
        action: 'auth.email_verification_failed',
        targetId: record.userId,
        metadata: { reason: user?.deletedAt ? 'account_deleted' : 'user_not_found' },
      });
      return NextResponse.json({
        error: 'Invalid verification token',
        reason: user?.deletedAt ? 'account_deleted' : 'user_not_found',
        email: user?.email ?? null,
      }, { status: 400 });
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
