import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { cancelAutoRenew } from '@/lib/payments';
import { checkRateLimit, paymentLimiter, getClientIp } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const allowed = await checkRateLimit(paymentLimiter, [ip, `user:${user.sub}`]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many payment requests, try again shortly' }, { status: 429 });
    }

    const sub = await cancelAutoRenew(user.sub);
    const { renewalAuthCode, ...safeSub } = sub;
    return NextResponse.json(safeSub);
  } catch (err) {
    return errorResponse(err);
  }
}
