import { NextRequest, NextResponse } from 'next/server';
import { verifyPaystackSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableAuthorization } from '@/lib/providers/paystack';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { getRequestId } from '@/lib/request-id';
import { persistWebhookEvent, markWebhookProcessing, markWebhookProcessed, markWebhookFailed, markWebhookIgnored } from '@/lib/webhook-events';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  let webhookEventId: string | undefined;
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

    const webhookEvent = await persistWebhookEvent({
      provider: 'paystack',
      providerEventId: body.id ?? body.data?.id ?? `${body.event}-${Date.now()}`,
      providerReference: body.data?.reference,
      eventType: body.event,
      payload: body,
    });

    webhookEventId = webhookEvent.id;

    await markWebhookProcessing(webhookEvent.id);

    if (body.event !== 'charge.success') {
      await markWebhookIgnored(webhookEvent.id);
      const res = NextResponse.json({ received: true });
      res.headers.set('x-request-id', requestId);
      return res;
    }

    const customerEmail = body.data?.customer?.email ?? null;

    const result = await handleVerifiedWebhook({
      providerReference: body.data.reference,
      status: body.data.status === 'success' ? 'success' : 'failed',
      amountPaid: body.data.amount / 100,
      currencyPaid: body.data.currency,
      customerEmail,
      rawPayload: body,
      renewalToken: extractReusableAuthorization(body),
    });

    await markWebhookProcessed(webhookEvent.id);

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
    if (webhookEventId) {
      await markWebhookFailed(webhookEventId, (err as Error).message).catch(() => {});
    }
    await writeAudit({
      action: 'payment.webhook_error',
      metadata: { provider: 'paystack', error: (err as Error).message, requestId },
    });
    return errorResponse(err);
  }
}
