import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse, ApiError } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import crypto from 'crypto';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const token = req.nextUrl.searchParams.get('token');
    if (!token) throw new ApiError(400, 'token is required');

    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.emailVerificationToken.findUnique({ where: { tokenHash } });

    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new ApiError(400, 'Invalid or expired verification link');
    }

    const user = await prisma.user.findUniqueOrThrow({ where: { id: record.userId } });
    if (user.emailVerifiedAt) {
      return NextResponse.json({ verified: true, message: 'Email already verified' });
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
      actorId: record.userId,
      action: 'auth.email_verified',
      targetId: record.userId,
    });

    return NextResponse.json({ verified: true, message: 'Email verified successfully' });
  } catch (err) {
    return errorResponse(err);
  }
}
