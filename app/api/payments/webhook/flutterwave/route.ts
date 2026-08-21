import { NextRequest, NextResponse } from 'next/server';
import { verifyFlutterwaveSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';
import { errorResponse } from '@/lib/rbac';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
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

    await writeAudit({
      action: 'payment.webhook_received',
      metadata: { provider: 'flutterwave', event: body.event, txRef: body.data?.tx_ref, txId: body.data?.id },
    });

    if (body.event !== 'charge.completed') {
      return NextResponse.json({ received: true });
    }

    const txRef = body.data?.tx_ref;
    const txId = body.data?.id;

    if (!txRef) {
      await writeAudit({
        action: 'payment.webhook_error',
        metadata: { provider: 'flutterwave', reason: 'missing_tx_ref' },
      });
      return NextResponse.json({ error: 'Missing transaction reference' }, { status: 400 });
    }

    // Independent API verification with Flutterwave to prevent webhook forgery/tampering
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
    await writeAudit({
      action: 'payment.webhook_error',
      metadata: { provider: 'flutterwave', error: (err as Error).message },
    });
    return errorResponse(err);
  }
}
