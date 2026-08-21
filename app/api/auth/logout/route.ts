import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { hashRefreshToken } from '@/lib/refresh-sessions';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';

    const token = req.cookies.get('refresh_token')?.value;
    if (token) {
      try {
        const tokenHash = hashRefreshToken(token);
        const session = await prisma.refreshSession.findFirst({
          where: { tokenHash, revokedAt: null },
        });
        if (session) {
          await prisma.refreshSession.update({
            where: { id: session.id },
            data: { revokedAt: new Date() },
          });
        }
      } catch {
        // best-effort revocation; if prisma is unavailable, still clear cookies
      }
    }

    try {
      await prisma.userSession.deleteMany({ where: {} });
    } catch {
      // best-effort cleanup
    }

    await writeAudit({
      action: 'auth.logout',
      metadata: { reason: 'user_initiated', ip },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.delete('access_token');
    res.cookies.delete('refresh_token');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
