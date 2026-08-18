import { NextRequest, NextResponse } from 'next/server';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get('x-forwarded-for') ?? 'unknown';
    await writeAudit({
      action: 'auth.logout',
      metadata: { reason: 'user_initiated', ip },
    });

    const res = NextResponse.json({ ok: true });
    res.cookies.delete({ name: 'access_token', path: '/', secure: true, sameSite: 'lax' });
    res.cookies.delete({ name: 'refresh_token', path: '/', secure: true, sameSite: 'lax' });
    return res;
  } catch (err) {
    return errorResponse(err);
  }
}
