import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);

    await writeAudit({
      actorId: user.sub,
      action: 'auth.logout',
      metadata: { reason: 'user_initiated' },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.delete('access_token');
    res.cookies.delete('refresh_token');
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
