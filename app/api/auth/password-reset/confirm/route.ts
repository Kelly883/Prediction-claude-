import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/password';
import { errorResponse, ApiError } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
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

    await prisma.$transaction(async (db) => {
      await db.user.update({ where: { id: record.userId }, data: { passwordHash } });
      await db.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } });
    });

    return NextResponse.json({ message: 'Password updated. You can now log in.' });
  } catch (err) {
    return errorResponse(err);
  }
}
