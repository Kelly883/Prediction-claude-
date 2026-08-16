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
      throw new ApiError(400, 'Invalid or expired verification token');
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
    });

    return NextResponse.json({ message: 'Email verified successfully' });
  } catch (err) {
    return errorResponse(err);
  }
}
