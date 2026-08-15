import { NextRequest, NextResponse } from 'next/server';
import { verifyPaystackSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableAuthorization } from '@/lib/providers/paystack';
import { errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

// Signature is computed over the exact raw request bytes, so this handler
// reads req.text() FIRST and never calls req.json() before verifying —
// re-serializing a parsed body can produce different bytes (key order,
// whitespace) and silently break signature verification.
export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature');

    if (!verifyPaystackSignature(rawBody, signature)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = JSON.parse(rawBody);
    if (body.event !== 'charge.success') return NextResponse.json({ received: true });

    const result = await handleVerifiedWebhook({
      providerReference: body.data.reference,
      status: body.data.status === 'success' ? 'success' : 'failed',
      amountPaid: body.data.amount / 100, // Paystack sends kobo
      currencyPaid: body.data.currency,
      rawPayload: body,
      renewalToken: extractReusableAuthorization(body),
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
