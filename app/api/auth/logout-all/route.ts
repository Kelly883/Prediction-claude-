import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requireUser, errorResponse } from '@/lib/rbac';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const user = await requireUser(req);

    await prisma.userSession.deleteMany({ where: { userId: user.sub } });

    await writeAudit({
      actorId: user.sub,
      action: 'auth.logout_all',
      metadata: { revokedSessions: true },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.delete('access_token');
    res.cookies.delete('refresh_token');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
