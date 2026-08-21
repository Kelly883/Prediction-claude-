import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { requirePermission, errorResponse, ApiError } from '@/lib/rbac';
import { handleVerifiedWebhook } from '@/lib/payments';
import { paystackVerifyTransaction } from '@/lib/providers/paystack';
import { flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';
import { getRequestId } from '@/lib/request-id';
import { writeAudit } from '@/lib/audit';
import { PERMISSIONS } from '@/lib/permissions';
import { requireSameOrigin, requireCsrf } from '@/lib/csrf';
import { toPaymentStatusDTO } from '@/lib/dtos';

export const runtime = 'nodejs';

function isSuccessStatus(status: string): boolean {
  return status === 'success' || status === 'successful';
}

export async function POST(req: NextRequest) {
  const requestId = getRequestId(req);
  try {
    requireSameOrigin(req);
    requireCsrf(req);
    const admin = await requirePermission(req, PERMISSIONS.pages.transactions);
    const body = await req.json();
    const { reference, provider } = body;

    if (!reference || !provider) {
      throw new ApiError(400, 'reference and provider are required');
    }

    const tx = await prisma.transaction.findUnique({
      where: { providerReference: reference },
      include: { plan: true, user: true },
    });

    if (!tx) {
      throw new ApiError(404, 'Transaction not found');
    }

    if (tx.status === 'success') {
      return NextResponse.json(toPaymentStatusDTO({ ...tx, status: 'success' }, 'Payment already confirmed'));
    }

    if (tx.status === 'failed' || tx.status === 'cancelled') {
      throw new ApiError(400, `Transaction already marked as ${tx.status}`);
    }

    let verification: { verified: boolean; status: string; amount: number; currency: string; customerEmail?: string; reusableToken?: string | null; raw: unknown };

    if (provider === 'paystack') {
      verification = await paystackVerifyTransaction({ reference });
    } else if (provider === 'flutterwave') {
      const txRefMatch = reference.match(/^(?:pp_)?(.+)$/);
      const txRef = txRefMatch ? txRefMatch[1] : reference;
      verification = await flutterwaveVerifyTransaction({ txRef });
    } else {
      throw new ApiError(400, 'Unsupported provider');
    }

    if (!verification.verified || !isSuccessStatus(verification.status)) {
      await writeAudit({
        actorId: admin.sub,
        action: 'payment.admin_verify_failed',
        targetId: tx.id,
        metadata: { provider, reference, status: verification.status },
      });
      throw new ApiError(400, 'Payment verification failed with provider');
    }

    const amountMatches = Number(tx.amount).toFixed(2) === verification.amount.toFixed(2);
    const currencyMatches = tx.currency === verification.currency;
    const userMatches = !verification.customerEmail || !tx.user?.email || verification.customerEmail.toLowerCase().trim() === tx.user.email.toLowerCase().trim();

    if (!amountMatches || !currencyMatches || !userMatches) {
      await writeAudit({
        actorId: admin.sub,
        action: 'payment.admin_verify_mismatch',
        targetId: tx.id,
        metadata: { provider, reference, amountMatches, currencyMatches, userMatches },
      });
      throw new ApiError(400, 'Transaction verification mismatch (amount, currency, or customer)');
    }

    const result = await handleVerifiedWebhook({
      providerReference: reference,
      status: 'success',
      amountPaid: verification.amount,
      currencyPaid: verification.currency,
      customerEmail: verification.customerEmail,
      rawPayload: { adminVerification: true, provider, verification: verification.raw },
      renewalToken: verification.reusableToken ?? null,
    });

    await writeAudit({
      actorId: admin.sub,
      action: 'payment.admin_verify_success',
      targetId: (result as any)?.id ?? tx.id,
      metadata: { provider, reference, amount: verification.amount, currency: verification.currency, userId: tx.userId },
    });

    return NextResponse.json({ status: 'success', message: 'Payment verified and subscription activated', transactionId: (result as any)?.id ?? tx.id });
  } catch (err) {
    return errorResponse(err);
  }
}
