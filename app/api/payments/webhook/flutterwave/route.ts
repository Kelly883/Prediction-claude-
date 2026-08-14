import { NextRequest, NextResponse } from 'next/server';
import { verifyFlutterwaveSignature, handleVerifiedWebhook } from '@/lib/payments';
import { extractReusableToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';
import { errorResponse } from '@/lib/rbac';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const hash = req.headers.get('verif-hash');
    if (!verifyFlutterwaveSignature(hash)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    const rawBody = await req.text();
    const body = JSON.parse(rawBody);
    if (body.event !== 'charge.completed') return NextResponse.json({ received: true });

    const txRef = body.data?.tx_ref;
    const txId = body.data?.id;

    if (!txRef) {
      return NextResponse.json({ error: 'Missing transaction reference' }, { status: 400 });
    }

    // Independent API verification with Flutterwave to prevent webhook forgery/tampering
    const verification = await flutterwaveVerifyTransaction({
      id: txId,
      txRef,
    });

    if (!verification.verified || verification.status !== 'successful') {
      // Record failure if transaction exists
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
      customerEmail: verification.customerEmail || (body.data?.customer?.email ?? null),
      rawPayload: { webhook: body, verification: verification.raw },
      renewalToken: verification.reusableToken ?? extractReusableToken(body),
    });

    return NextResponse.json(result);
  } catch (err) {
    return errorResponse(err);
  }
}
