import { NextRequest, NextResponse } from 'next/server';
import { verifyFlutterwaveSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';
import { persistWebhookEvent, markWebhookProcessing, markWebhookProcessed, markWebhookFailed, markWebhookIgnored } from '@/lib/webhook-events';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  let webhookEventId: string | undefined;
  try {
    const hash = req.headers.get('verif-hash');
    if (!verifyFlutterwaveSignature(hash)) {
      await writeAudit({
        action: 'payment.webhook_rejected',
        metadata: { provider: 'flutterwave', reason: 'invalid_signature' },
      });
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const rawBody = await req.text();
    const body = JSON.parse(rawBody);

    const webhookEvent = await persistWebhookEvent({
      provider: 'flutterwave',
      providerEventId: body.id ?? body.data?.id ?? `${body.event}-${Date.now()}`,
      providerReference: body.data?.tx_ref,
      eventType: body.event,
      payload: body,
    });

    webhookEventId = webhookEvent.id;

    await markWebhookProcessing(webhookEvent.id);

    await writeAudit({
      action: 'payment.webhook_received',
      metadata: { provider: 'flutterwave', event: body.event, txRef: body.data?.tx_ref, txId: body.data?.id },
    });

    if (body.event !== 'charge.completed') {
      await markWebhookIgnored(webhookEvent.id);
      return NextResponse.json({ received: true });
    }

    const txRef = body.data?.tx_ref;
    const txId = body.data?.id;

    if (!txRef) {
      await writeAudit({
        action: 'payment.webhook_error',
        metadata: { provider: 'flutterwave', reason: 'missing_tx_ref' },
      });
      await markWebhookFailed(webhookEvent.id, 'missing_tx_ref');
      return NextResponse.json({ error: 'Missing transaction reference' }, { status: 400 });
    }

    const verification = await flutterwaveVerifyTransaction({
      id: txId,
      txRef,
    });

    if (!verification.verified || verification.status !== 'successful') {
      await writeAudit({
        action: 'payment.webhook_verification_failed',
        targetId: txRef,
        metadata: { provider: 'flutterwave', txId, txRef, status: verification.status },
      });
      await handleVerifiedWebhook({
        providerReference: txRef,
        status: 'failed',
        amountPaid: verification.amount || Number(body.data?.amount) || 0,
        currencyPaid: verification.currency || body.data?.currency || 'NGN',
        customerEmail: verification.customerEmail || body.data?.customer?.email,
        rawPayload: { webhook: body, verification: verification.raw },
      }).catch(() => {});
      await markWebhookFailed(webhookEvent.id, `verification_failed: ${verification.status}`);
      return NextResponse.json({ error: 'Transaction verification failed' }, { status: 400 });
    }

    const result = await handleVerifiedWebhook({
      providerReference: verification.txRef || txRef,
      status: 'success',
      amountPaid: verification.amount,
      currencyPaid: verification.currency,
      customerEmail: verification.customerEmail,
      rawPayload: { webhook: body, verification: verification.raw },
      renewalToken: verification.reusableToken ?? extractReusableToken(body),
    });

    await markWebhookProcessed(webhookEvent.id);

    await writeAudit({
      action: 'payment.webhook_processed',
      targetId: (result as any)?.id ?? txRef,
      metadata: {
        provider: 'flutterwave',
        txRef,
        txId,
        status: 'success',
        amount: verification.amount,
        currency: verification.currency,
        customerEmail: verification.customerEmail,
      },
    });

    return NextResponse.json(result);
  } catch (err) {
    if (webhookEventId) {
      await markWebhookFailed(webhookEventId, (err as Error).message).catch(() => {});
    }
    await writeAudit({
      action: 'payment.webhook_error',
      metadata: { provider: 'flutterwave', error: (err as Error).message },
    });
    return errorResponse(err);
  }
}