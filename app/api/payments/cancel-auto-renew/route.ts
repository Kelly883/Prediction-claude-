import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { cancelAutoRenew } from '@/lib/payments';
import { checkRateLimit, paymentLimiter, getClientIp, normalizeIdentifier } from '@/lib/ratelimit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ip = getClientIp(req);
    const userId = normalizeIdentifier('user', user.sub);

    const allowed = await checkRateLimit(paymentLimiter, [ip, userId]);
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const sub = await cancelAutoRenew(user.sub);
    return NextResponse.json(sub);
  } catch (err) {
    return errorResponse(err);
  }
}
