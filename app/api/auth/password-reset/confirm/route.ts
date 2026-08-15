import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { checkRateLimit, authLimiter, getClientIp } from '@/lib/ratelimit';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(authLimiter, ip);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many attempts, try again shortly' }, { status: 429 });
    }

    const { token, newPassword } = await req.json();
    if (!token || !newPassword || newPassword.length < 8) {
      throw new ApiError(400, 'token and a newPassword of at least 8 characters are required');
    }

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new ApiError(400, 'Reset link is invalid or has expired');
    }

    const passwordHash = await hashPassword(newPassword);

    // ATOMIC TRANSACTION:
    // 1. Update passwordHash and increment tokenVersion (invalidating existing refresh tokens).
    // 2. Revoke all active user sessions across all devices.
    // 3. Mark the password reset token as used (only after password update succeeds).
    await prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          tokenVersion: { increment: 1 },
        },
      });

      await db.userSession.deleteMany({
        where: { userId: record.userId },
      });

      await db.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      });
    });

    await writeAudit({
      actorId: record.userId,
      action: 'auth.password_reset_confirmed',
      targetId: record.userId,
      metadata: { ip },
    });

    return NextResponse.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    return errorResponse(err);
  }
}
