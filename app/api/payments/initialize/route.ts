import { NextRequest, NextResponse } from 'next/server';
import { requireUser, errorResponse } from '@/lib/rbac';
import { initializePayment } from '@/lib/payments';
import { checkRateLimit, defaultLimiter } from '@/lib/ratelimit';
import { InitializePaymentSchema } from '@/lib/schemas';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    if (!(await checkRateLimit(defaultLimiter, user.sub))) {
      return NextResponse.json({ error: 'Too many requests, try again shortly' }, { status: 429 });
    }

    const { planId, provider } = InitializePaymentSchema.parse(await req.json());
    const result = await initializePayment(user.sub, planId, provider ?? 'paystack');
    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
