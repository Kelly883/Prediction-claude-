import { NextRequest, NextResponse } from 'next/server';
import { verifyPaystackSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableAuthorization } from '@/lib/providers/paystack';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { getRequestId } from '@/lib/request-id';

export const runtime = 'nodejs';

// Signature is computed over the exact raw request bytes, so this handler
// reads req.text() FIRST and never calls req.json() before verifying —
// re-serializing a parsed body can produce different bytes (key order,
// whitespace) and silently break signature verification.
export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  try {
    const rawBody = await req.text();
    const signature = req.headers.get('x-paystack-signature');

    if (!verifyPaystackSignature(rawBody, signature)) {
      await writeAudit({
        action: 'payment.webhook_rejected',
        metadata: { provider: 'paystack', reason: 'invalid_signature', requestId },
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const body = JSON.parse(rawBody);
    await writeAudit({
      action: 'payment.webhook_received',
      metadata: { provider: 'paystack', event: body.event, reference: body.data?.reference, requestId },
    });

    if (body.event !== 'charge.success') {
      const res = NextResponse.json({ received: true });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    const customerEmail = body.data?.customer?.email ?? null;

    const result = await handleVerifiedWebhook({
      providerReference: body.data.reference,
      status: body.data.status === 'success' ? 'success' : 'failed',
      amountPaid: body.data.amount / 100, // Paystack sends kobo
      currencyPaid: body.data.currency,
      customerEmail,
      rawPayload: body,
      renewalToken: extractReusableAuthorization(body),
    });

    await writeAudit({
      action: 'payment.webhook_processed',
      targetId: (result as any)?.id ?? body.data.reference,
      metadata: {
        provider: 'paystack',
        reference: body.data.reference,
        status: body.data.status,
        amount: body.data.amount,
        currency: body.data.currency,
        customerEmail,
      },
    });

    const res = NextResponse.json(result);
    res.headers.set('x-request-id', requestId);
    return res;
  } catch (err) {
    await writeAudit({
      action: 'payment.webhook_error',
      metadata: { provider: 'paystack', error: (err as Error).message, requestId },
    });
    return errorResponse(err);
  }
}
