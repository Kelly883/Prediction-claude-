import { NextRequest, NextResponse } from 'next/server';
import { verifyFlutterwaveSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableToken } from '@/lib/providers/flutterwave';
import { errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const hash = req.headers.get('verif-hash');
    if (!verifyFlutterwaveSignature(hash)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = await req.json();
    if (body.event !== 'charge.completed') return NextResponse.json({ received: true });

    const result = await handleVerifiedWebhook({
      providerReference: body.data.tx_ref,
      status: body.data.status === 'successful' ? 'success' : 'failed',
      amountPaid: body.data.amount,
      currencyPaid: body.data.currency,
      customerEmail: body.data.customer?.email ?? null,
      rawPayload: body,
      renewalToken: extractReusableToken(body),
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
