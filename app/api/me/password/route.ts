import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse, ApiError } from '@/lib/rbac';
import { hashPassword, verifyPassword } from '@/lib/password';
import { ChangePasswordSchema } from '@/lib/schemas';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function PATCH(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { currentPassword, newPassword } = ChangePasswordSchema.parse(await req.json());

    const record = await prisma.user.findUniqueOrThrow({ where: { id: user.sub } });

    if (!(await verifyPassword(currentPassword, record.passwordHash))) {
      await writeAudit({
        actorId: user.sub,
        action: 'auth.password_change_failed',
        metadata: { reason: 'invalid_current_password' },
      });
      throw new ApiError(401, 'Current password is incorrect');
    }

    const newHash = await hashPassword(newPassword);

    await prisma.$transaction(async (db) => {
      await db.user.update({
        where: { id: user.sub },
        data: {
          passwordHash: newHash,
          tokenVersion: { increment: 1 },
        },
      });

      await db.userSession.deleteMany({
        where: { userId: user.sub },
      });
    });

    await writeAudit({
      actorId: user.sub,
      action: 'auth.password_changed',
      targetId: user.sub,
    });

    return NextResponse.json({ message: 'Password updated. You have been logged out of all devices.' });
  } catch (err) {
    return errorResponse(err);
  }
}
