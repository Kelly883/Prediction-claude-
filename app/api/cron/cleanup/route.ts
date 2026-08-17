import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { timingSafeStringEqual } from '@/lib/timing-safe';

export const runtime = 'nodejs';
export const maxDuration = 60;

const PASSWORD_RESET_TOKEN_RETENTION_HOURS = 24;
const USER_SESSION_RETENTION_DAYS = 90;
const USER_SESSION_INACTIVITY_DAYS = 30;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !authHeader || !timingSafeStringEqual(authHeader, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const results = { passwordResetTokensDeleted: 0, sessionsDeleted: 0, inactiveSessionsDeleted: 0, errors: [] as string[] };

  try {
    const oldResetCutoff = new Date(now.getTime() - PASSWORD_RESET_TOKEN_RETENTION_HOURS * 60 * 60 * 1000);
    const deleteResetResult = await prisma.passwordResetToken.deleteMany({
      where: {
        OR: [
          { expiresAt: { lt: now } },
          { usedAt: { not: null, lt: oldResetCutoff } },
        ],
      },
    });
    results.passwordResetTokensDeleted = deleteResetResult.count;
  } catch (err) {
    results.errors.push(`password reset token cleanup failed: ${(err as Error).message}`);
  }

  try {
    const oldSessionCutoff = new Date(now.getTime() - USER_SESSION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const deleteSessionResult = await prisma.userSession.deleteMany({
      where: { lastSeenAt: { lt: oldSessionCutoff } },
    });
    results.sessionsDeleted = deleteSessionResult.count;
  } catch (err) {
    results.errors.push(`user session cleanup failed: ${(err as Error).message}`);
  }

  try {
    const inactiveCutoff = new Date(now.getTime() - USER_SESSION_INACTIVITY_DAYS * 24 * 60 * 60 * 1000);
    const deleteInactiveResult = await prisma.userSession.deleteMany({
      where: { lastSeenAt: { lt: inactiveCutoff } },
    });
    results.inactiveSessionsDeleted = deleteInactiveResult.count;
  } catch (err) {
    results.errors.push(`inactive session cleanup failed: ${(err as Error).message}`);
  }

  return NextResponse.json(results);
}
