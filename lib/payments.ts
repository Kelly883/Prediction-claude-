import crypto from 'crypto';
import { Prisma, PaymentProvider } from '@prisma/client';
import { prisma } from './prisma';
import { getFxRate } from './fx';
import { ApiError } from './rbac';
import { paystackInitialize } from './providers/paystack';
import { flutterwaveInitialize } from './providers/flutterwave';
import { timingSafeStringEqual } from './timing-safe';
import { encryptPaymentToken } from './encryption';
import { writeAudit } from './audit';

// Implements design doc Section 5.2 (Payment + Entitlement Activation) and
// the early-renewal rule from PRD Section 9: newEnd = max(currentEnd, now) + planDuration.

export async function initializePayment(
  userId: string,
  planId: string,
  provider: 'paystack' | 'flutterwave' = 'paystack',
) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await prisma.plan.findUniqueOrThrow({ where: { id: planId } });

  const { amount, currency, fxRateUsed } = await resolvePrice(plan, user.country);

  // We generate our own reference and hand it to the provider up front
  // (both Paystack and Flutterwave echo back whatever reference/tx_ref we
  // send in their webhook payload), so there's no need to create a
  // placeholder reference and rewrite it after the fact.
  const idempotencyKey = crypto.randomUUID();
  const reference = `pp_${idempotencyKey}`;
  const callbackUrl = `${requireAppUrl()}/payments/callback`;

  let checkoutUrl: string;
  if (provider === 'paystack') {
    const { authorizationUrl } = await paystackInitialize({
      email: user.email,
      amountMinorUnits: toMinorUnits(amount, currency),
      currency,
      reference,
      callbackUrl,
    });
    checkoutUrl = authorizationUrl;
  } else {
    const { paymentLink } = await flutterwaveInitialize({
      txRef: reference,
      amount,
      currency,
      redirectUrl: callbackUrl,
      customerEmail: user.email,
    });
    checkoutUrl = paymentLink;
  }

  const tx = await prisma.transaction.create({
    data: { userId, planId, provider, providerReference: reference, idempotencyKey, amount, currency, fxRateUsed, status: 'pending' },
  });

  return { transactionId: tx.id, amount, currency, checkoutUrl };
}

export async function resolvePrice(
  plan: { priceNGN: any; priceUSDOverride: any; fxMarkupPercent: any },
  userCountry: string,
): Promise<{ amount: number; currency: 'NGN' | 'USD'; fxRateUsed?: number }> {
  const isNigeria = userCountry === 'NG';
  if (isNigeria) return { amount: Number(plan.priceNGN), currency: 'NGN' };

  if (plan.priceUSDOverride) return { amount: Number(plan.priceUSDOverride), currency: 'USD' };

  const rate = await getFxRate('NGN', 'USD');
  const markup = Number(plan.fxMarkupPercent ?? 0) / 100;
  const amount = Number(plan.priceNGN) * rate * (1 + markup);
  return { amount, currency: 'USD', fxRateUsed: rate };
}

/** Paystack wants amounts in the smallest currency unit (kobo/cents); Flutterwave wants major units. */
export function toMinorUnits(amount: number, currency: string): number {
  return Math.round(amount * 100);
}

function requireAppUrl(): string {
  const url = process.env.APP_URL;
  if (!url) throw new Error('APP_URL env var is required to build payment callback/redirect URLs');
  return url;
}

export async function handleVerifiedWebhook(params: {
  providerReference: string;
  status: 'success' | 'failed';
  amountPaid: number;
  currencyPaid: string;
  customerEmail?: string | null;
  rawPayload: unknown;
  /** Reusable authorization code / card token, if the provider returned one on this charge. */
  renewalToken?: string | null;
}) {
  const tx = await prisma.transaction.findUnique({
    where: { providerReference: params.providerReference },
    include: { user: true },
  });
  if (!tx) throw new ApiError(400, 'Unknown transaction reference');

  // Idempotency: webhooks can and will be retried by the provider. If this
  // reference was already processed (status is in a terminal state: success, failed, cancelled),
  // return immediately with no-op.
  if (tx.status === 'success' || tx.status === 'failed' || tx.status === 'cancelled') {
    return tx;
  }

  const now = new Date();

  // Validate amount, currency, and customer email match expected transaction record
  const amountMatches = Number(tx.amount).toFixed(2) === params.amountPaid.toFixed(2);
  const currencyMatches = tx.currency === params.currencyPaid;
  const userMatches =
    !params.customerEmail || !tx.user?.email || params.customerEmail.toLowerCase().trim() === tx.user.email.toLowerCase().trim();

  if (!amountMatches || !currencyMatches || !userMatches) {
    await prisma.transaction.updateMany({
      where: {
        id: tx.id,
        status: { in: ['pending', 'processing'] },
      },
      data: {
        status: 'failed',
        completedAt: now,
        rawPayload: params.rawPayload as any,
      },
    });
    throw new ApiError(400, 'Transaction verification mismatch (amount, currency, or customer)');
  }

  return prisma.$transaction(async (db) => {
    // ATOMIC STATE TRANSITION:
    // Only transition if the transaction is still pending or processing.
    // This strictly enforces that pending -> success is executed exactly once,
    // even under concurrent webhook deliveries.
    const result = await db.transaction.updateMany({
      where: {
        id: tx.id,
        status: { in: ['pending', 'processing'] },
      },
      data: {
        status: params.status,
        completedAt: now,
        rawPayload: params.rawPayload as any,
      },
    });

    if (result.count === 0) {
      // Another concurrent worker/webhook already transitioned this transaction
      return db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    }

    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } });

    if (params.status === 'success') {
      await activateOrRenewSubscription(db, tx.userId, updated.id, tx.provider, params.renewalToken ?? null);
    }

    return updated;
  });
}

async function activateOrRenewSubscription(
  db: Prisma.TransactionClient,
  userId: string,
  transactionId: string,
  provider: PaymentProvider,
  renewalToken: string | null,
) {
  const tx = await db.transaction.findUnique({ where: { id: transactionId } });
  if (!tx) throw new Error(`activateOrRenewSubscription: transaction ${transactionId} not found`);
  if (!tx.planId) throw new Error(`activateOrRenewSubscription: transaction ${transactionId} has no planId — can't determine which plan to activate`);

  const plan = await db.plan.findUnique({ where: { id: tx.planId } });
  if (!plan) throw new Error(`activateOrRenewSubscription: plan ${tx.planId} not found`);

  const existing = await db.subscription.findFirst({ where: { userId, status: 'active' }, orderBy: { endAt: 'desc' } });

  const now = new Date();
  const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;

  // Reusable payment method (Paystack auth code / Flutterwave card token) is ALWAYS encrypted at rest using AES-256-GCM
  const encryptedRenewalAuthCode = renewalToken ? encryptPaymentToken(renewalToken) : undefined;

  // Any successful charge — first payment or renewal — resets the retry
  // counter and (if the provider gave us one) refreshes the stored encrypted payment
  // method for future auto-renewals, as well as releasing any renewal lock.
  const renewalFields = {
    renewalAttempts: 0,
    lastRenewalError: null,
    renewalStatus: 'idle' as const,
    renewalLockedAt: null,
    renewalReference: null,
    ...(encryptedRenewalAuthCode ? { renewalProvider: provider, renewalAuthCode: encryptedRenewalAuthCode } : {}),
  };

  if (renewalToken) {
    // Log security audit event for payment authorization update (never logging token in metadata)
    await writeAudit({
      actorId: userId,
      action: 'payment.authorization_updated',
      targetId: transactionId,
      metadata: { provider },
    });
  }

  if (existing) {
    const newEnd = new Date(Math.max(existing.endAt.getTime(), now.getTime()) + durationMs);
    await db.subscription.update({ where: { id: existing.id }, data: { endAt: newEnd, status: 'active', ...renewalFields } });
    await db.transaction.update({ where: { id: transactionId }, data: { subscriptionId: existing.id } });
  } else {
    const sub = await db.subscription.create({
      data: {
        userId,
        planId: tx.planId,
        status: 'active',
        autoRenew: true,
        startAt: now,
        endAt: new Date(now.getTime() + durationMs),
        ...renewalFields,
      },
    });
    await db.transaction.update({ where: { id: transactionId }, data: { subscriptionId: sub.id } });
  }
}

export async function cancelAutoRenew(userId: string) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: 'active' }, orderBy: { endAt: 'desc' } });
  if (!sub) throw new ApiError(400, 'No active subscription');
  // Access persists until endAt — only future renewals stop.
  return prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: false } });
}

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  // Verified against Paystack's current docs (paystack.com/docs/payments/webhooks):
  // x-paystack-signature header, HMAC-SHA512 of the raw body, keyed with the
  // secret key. Note it's SHA-512, not the SHA-256 most other providers use.
  if (!signature || !process.env.PAYSTACK_SECRET_KEY) return false;
  const expected = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest('hex');
  return timingSafeStringEqual(expected, signature);
}

export function verifyFlutterwaveSignature(hash: string | null): boolean {
  // Verified against Flutterwave's current docs: verif-hash header, plain
  // string equality against the secret hash configured in the dashboard —
  // not HMAC.
  if (!hash || !process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH) return false;
  return timingSafeStringEqual(hash, process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH);
}
