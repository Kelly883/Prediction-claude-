import crypto from 'crypto';
import { Prisma, PaymentProvider, Currency } from '@prisma/client';
import { prisma } from './prisma';
import { getFxRate } from './fx';
import { ApiError } from './rbac';
import { paystackInitialize } from './providers/paystack';
import { flutterwaveInitialize } from './providers/flutterwave';
import { extractProviderTransactionId as extractPzProviderTransactionId } from './providers/paystack';
import { extractProviderTransactionId as extractFwProviderTransactionId } from './providers/flutterwave';
import { ProviderInitError } from './providers/init-error';
import { timingSafeStringEqual } from './timing-safe';
import { encryptPaymentToken } from './encryption';
import { writeAudit } from './audit';
import { getEnv, requireAppUrl, requirePaystack, requireFlutterwave } from '@/lib/env';

// Re-export provider transaction ID extractors for use in other modules (e.g., cron route)
export { extractPzProviderTransactionId, extractFwProviderTransactionId };

// Keys that carry reusable payment credentials (or subtrees that contain them)
// must never be persisted in cleartext. `authorization`/`card` are dropped as
// whole subtrees so a nested `authorization_code` / `token` cannot survive under
// an alternative property name.
const SENSITIVE_PAYLOAD_KEYS = new Set([
  'authorization_code',
  'card_token',
  'token',
  'secret',
  'password',
  'cvv',
  'pin',
  'otp',
  'raw',
  'authorization',
  'card',
  'reusableauthorization',
  'reusabletoken',
  'signature',
]);

/**
 * Read-path defence-in-depth: replaces sensitive values with a marker so legacy
 * rows that may still contain cleartext credentials are masked on the way out.
 * This is NOT the primary control — writes are sanitized via
 * `sanitizeRawPayload` so cleartext never lands in the database in the first place.
 */
export function redactPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key.toLowerCase())) {
      clone[key] = '[redacted]';
      continue;
    }
    clone[key] = redactPayload(value);
  }
  return clone;
}

/**
 * Write-path control (F-01): recursively DROPS any key that carries a reusable
 * payment credential (or a subtree that contains one) before the payload is
 * persisted to `Transaction.rawPayload`. Ordinary, non-sensitive metadata
 * (event, reference, amount, currency, status, customer email, etc.) is kept.
 */
export function sanitizeRawPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(sanitizeRawPayload);

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (SENSITIVE_PAYLOAD_KEYS.has(key.toLowerCase())) continue;
    clone[key] = sanitizeRawPayload(value);
  }
  return clone;
}

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
  const callbackUrl = `${requireAppUrl()}/payments/callback?provider=${provider}`;

  // P-02: Persist the internal pending transaction BEFORE contacting the
  // provider. If this insert fails we must not create a provider checkout —
  // otherwise a customer could pay against a reference we have no record of,
  // and the webhook could never activate the subscription.
  const tx = await prisma.transaction.create({
    data: {
      userId,
      planId,
      provider,
      providerReference: reference,
      obligationId: canonicalObligationIdFromReference(reference),
      idempotencyKey,
      amount,
      currency,
      fxRateUsed,
      status: 'pending',
    },
  });

  let checkoutUrl: string;
  try {
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
  } catch (err) {
    // A definitive provider rejection (the provider replied and refused) means
    // this attempt can never be paid, so mark the existing row failed. A
    // network/timeout error is *uncertain* — the checkout may or may not have
    // been created — so the pending record is preserved for investigation and
    // recovery, and is never deleted.
    if (err instanceof ProviderInitError && err.definitive) {
      await prisma.transaction
        .update({
          where: { id: tx.id },
          data: { status: 'failed', completedAt: new Date(), rawPayload: sanitizeRawPayload({ providerInitError: err.message }) as any },
        })
        .catch(() => {});
    }
    throw err;
  }

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
export function toMinorUnits(amount: number, _currency: string): number {
  return Math.round(amount * 100);
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
  const MAX_RAW_PAYLOAD_SIZE = 64 * 1024; // 64KB limit
  const rawPayloadStr = JSON.stringify(params.rawPayload);
  if (Buffer.byteLength(rawPayloadStr, 'utf8') > MAX_RAW_PAYLOAD_SIZE) {
    params.rawPayload = { error: 'Payload exceeded maximum size limit', size: Buffer.byteLength(rawPayloadStr, 'utf8') };
  }

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
        rawPayload: sanitizeRawPayload(params.rawPayload) as any,
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
        rawPayload: sanitizeRawPayload(params.rawPayload) as any,
      },
    });

    if (result.count === 0) {
      // Another concurrent worker/webhook already transitioned this transaction
      return db.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    }

    const updated = await db.transaction.findUniqueOrThrow({ where: { id: tx.id } });

    if (params.status === 'success') {
      // Extract provider transaction ID for cross-path idempotency
      const providerTransactionId =
        tx.provider === 'paystack'
          ? extractPzProviderTransactionId(params.rawPayload)
          : extractFwProviderTransactionId(params.rawPayload);
      await activateOrRenewSubscription(db, tx.userId, updated.id, tx.provider, params.renewalToken ?? null, providerTransactionId, params.rawPayload);
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
  providerTransactionId: string | null,
  rawPayload: unknown,
) {
  const tx = await db.transaction.findUnique({ where: { id: transactionId } });
  if (!tx) throw new Error(`activateOrRenewSubscription: transaction ${transactionId} not found`);
  if (!tx.planId) throw new Error(`activateOrRenewSubscription: transaction ${transactionId} has no planId — can't determine which plan to activate`);

  const plan = await db.plan.findUnique({ where: { id: tx.planId } });
  if (!plan) throw new Error(`activateOrRenewSubscription: plan ${tx.planId} not found`);

  const existing = await db.subscription.findFirst({ where: { userId, status: 'active' }, orderBy: { endAt: 'desc' } });
  if (!existing) {
    // No existing subscription — create new one (first payment)
    const now = new Date();
    const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
    const encryptedRenewalAuthCode = renewalToken ? encryptPaymentToken(renewalToken) : undefined;
    const renewalFields = {
      renewalAttempts: 0,
      lastRenewalError: null,
      renewalStatus: 'idle' as const,
      renewalLockedAt: null,
      renewalReference: null,
      ...(encryptedRenewalAuthCode ? { renewalProvider: provider, renewalAuthCode: encryptedRenewalAuthCode } : {}),
    };
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
    // Set the billing obligation identity for the initial period. The period
    // starts at startAt; the obligation ID is immutable during the period's
    // lifetime and is the single source of truth for all processing paths.
    await db.subscription.update({
      where: { id: sub.id },
      data: {
        billingObligationId: canonicalObligationId(sub.id, sub.startAt.getTime()),
      },
    });
    await db.transaction.update({ where: { id: transactionId }, data: { subscriptionId: sub.id } });
    if (renewalToken) {
      await writeAudit({
        actorId: userId,
        action: 'payment.authorization_updated',
        targetId: transactionId,
        metadata: { provider },
      });
    }
    return;
  }

  // Existing subscription — use shared entitlement application
  const now = new Date();

  // Resolve the canonical billing obligation identity from the subscription's
  // stored billingObligationId. This is immutable during a period's lifetime
  // and does not depend on the mutable endAt, so webhook and cron always
  // converge on the same identity for the same billing period.
  let obligationId = existing.billingObligationId;
  if (!obligationId) {
    // Legacy subscription without a stored obligation ID: derive from the
    // current endAt (start of the new period) and persist it for future use.
    obligationId = canonicalObligationId(existing.id, existing.endAt.getTime());
    await db.subscription.update({
      where: { id: existing.id },
      data: { billingObligationId: obligationId },
    });
  }

  // Align the transaction's obligationId with the canonical obligation
  // identity. The transaction was created during initializePayment with a
  // provider-reference-derived obligationId; we correct it here so webhook
  // and cron converge on the same obligation identity for the same obligation.
  await db.transaction.update({
    where: { id: transactionId },
    data: { obligationId },
  });

  const _result = await applyEntitlementIfNotApplied(db, {
    userId,
    subscriptionId: existing.id,
    plan: { id: plan.id, durationDays: plan.durationDays },
    provider,
    providerReference: tx.providerReference,
    obligationId,
    providerTransactionId,
    amount: Number(tx.amount),
    currency: tx.currency,
    fxRateUsed: Number(tx.fxRateUsed ?? 0),
    renewalToken,
    rawPayload,
    now,
  });

  // Update renewal fields if renewalToken provided
  if (renewalToken) {
    const encryptedRenewalAuthCode = encryptPaymentToken(renewalToken);
    await db.subscription.update({
      where: { id: existing.id },
      data: {
        renewalProvider: provider,
        renewalAuthCode: encryptedRenewalAuthCode,
        renewalAttempts: 0,
        lastRenewalError: null,
        renewalStatus: 'idle',
        renewalLockedAt: null,
        renewalReference: null,
      },
    });
    // Log security audit event for payment authorization update (never logging token in metadata)
    await writeAudit({
      actorId: userId,
      action: 'payment.authorization_updated',
      targetId: transactionId,
      metadata: { provider },
    });
  }
}

/**
 * Shared entitlement application with cross-path idempotency.
 *
 * Enforces at-most-one entitlement application per canonical billing
 * obligation using database-level uniqueness on `Transaction.obligationId`
 * and `(provider, providerTransactionId)`. Application-level `findUnique`
 * checks are fast-path optimizations only; the database constraints are the
 * authoritative concurrency guard.
 *
 * The `obligationId` parameter is the canonical billing obligation identity,
 * derived from `subscriptionId + periodEpoch` (the business obligation), NOT
 * from any provider reference. Both webhook and cron compute the same
 * `obligation_${subscriptionId}_${periodEpoch}` for the same obligation,
 * so they converge on one entitlement application.
 *
 * Returns { applied: true, subscription } if entitlement was newly applied,
 * or { applied: false, subscription } if already applied (idempotent).
 */
async function applyEntitlementIfNotApplied(
  db: Prisma.TransactionClient,
  params: {
    userId: string;
    subscriptionId: string;
    plan: { id: string; durationDays: number };
    provider: PaymentProvider;
    providerReference: string;
    obligationId: string;
    providerTransactionId: string | null;
    amount: number;
    currency: Currency;
    fxRateUsed: number | null;
    renewalToken: string | null;
    rawPayload: unknown;
    now: Date;
  },
): Promise<{ applied: boolean; subscription: { id: string; endAt: Date } }> {
  const obligationId = params.obligationId;

  // 1. Fast-path: check if entitlement already applied for this obligation.
  //    `resultingEndAt` is set only after a successful entitlement application.
  const existingByObligation = await db.transaction.findUnique({
    where: { obligationId },
    select: { id: true, resultingEndAt: true },
  });
  if (existingByObligation?.resultingEndAt) {
    const sub = await db.subscription.findUnique({
      where: { id: params.subscriptionId },
      select: { id: true, endAt: true },
    });
    return { applied: false, subscription: sub! };
  }

  // 2. Fast-path: check provider-transaction deduplication (cross-path).
  if (params.providerTransactionId) {
    const existingByProviderTx = await db.transaction.findUnique({
      where: {
        provider_providerTransactionId: {
          provider: params.provider,
          providerTransactionId: params.providerTransactionId,
        },
      },
      select: { id: true, resultingEndAt: true },
    });
    if (existingByProviderTx?.resultingEndAt) {
      const sub = await db.subscription.findUnique({
        where: { id: params.subscriptionId },
        select: { id: true, endAt: true },
      });
      return { applied: false, subscription: sub! };
    }
  }

  // 3. Find or create the entitlement transaction record.
  let txRecord = existingByObligation;
  if (!txRecord) {
    try {
      txRecord = await db.transaction.create({
        data: {
          userId: params.userId,
          subscriptionId: params.subscriptionId,
          planId: params.plan.id,
          provider: params.provider,
          providerReference: params.providerReference,
          obligationId,
          providerTransactionId: params.providerTransactionId,
          idempotencyKey: crypto.randomUUID(),
          amount: params.amount,
          currency: params.currency,
          fxRateUsed: params.fxRateUsed,
          status: 'success',
          completedAt: params.now,
          rawPayload: sanitizeRawPayload(params.rawPayload) as any,
        },
      });
    } catch (err) {
      const prismaErr = err as { code?: string };
      if (prismaErr.code === 'P2002') {
        // Database unique constraint enforced concurrency — another
        // transaction already claimed this obligation. Re-read and recognize
        // the existing result idempotently.
        const reRead = await db.transaction.findUnique({
          where: { obligationId },
          select: { id: true, resultingEndAt: true },
        });
        if (reRead?.resultingEndAt) {
          const sub = await db.subscription.findUnique({
            where: { id: params.subscriptionId },
            select: { id: true, endAt: true },
          });
          return { applied: false, subscription: sub! };
        }
        if (reRead) {
          txRecord = reRead;
        } else {
          // Obligation not found despite P2002 — unexpected; re-throw.
          throw err;
        }
      } else {
        throw err;
      }
    }
  } else {
    // Existing record from initializePayment — update it to mark entitlement.
    txRecord = await db.transaction.update({
      where: { id: txRecord.id },
      data: {
        status: 'success',
        completedAt: params.now,
        subscriptionId: params.subscriptionId,
        providerTransactionId: params.providerTransactionId,
        rawPayload: sanitizeRawPayload(params.rawPayload) as any,
      },
    });
  }

  // 4. Capture previous expiry for audit before atomic update.
  const currentSub = await db.subscription.findUnique({
    where: { id: params.subscriptionId },
    select: { endAt: true },
  });
  const previousEndAt = currentSub?.endAt ?? null;

  // 5. Atomic subscription expiry update:
  //    newEndAt = GREATEST(currentEndAt, now) + durationDays
  //    Single SQL statement — no read-then-write race window. An expired
  //    subscription extends from now; an active one extends from its current
  //    expiry. Concurrent extensions are serialized by the row lock.
  //    Renewal fields are reset on successful entitlement application.
  await db.$executeRawUnsafe(
    `UPDATE "Subscription"
       SET "endAt" = GREATEST("endAt", $1::timestamptz) + ($2 * interval '1 day'),
           "updatedAt" = $1::timestamptz,
           "renewalStatus" = 'idle',
           "renewalLockedAt" = NULL,
           "renewalReference" = NULL,
           "renewalAttempts" = 0,
           "lastRenewalError" = NULL
     WHERE "id" = $3 AND "status" = 'active'`,
    params.now,
    params.plan.durationDays,
    params.subscriptionId,
  );

  // 6. Read resulting expiry and persist to audit fields.
  const updatedSub = await db.subscription.findUnique({
    where: { id: params.subscriptionId },
    select: { id: true, endAt: true },
  });
  const resultingEndAt = updatedSub?.endAt ?? null;

  // 7. Persist audit fields on the transaction record.
  await db.transaction.update({
    where: { id: txRecord.id },
    data: {
      previousEndAt,
      resultingEndAt,
    },
  });

  // 8. Update the subscription's billingObligationId to point to the NEXT
  //    billing period. The obligation just applied (identified by obligationId)
  //    is now complete; the next period starts at the resulting endAt.
  //    This stored identity is immutable during a period's lifetime and is the
  //    single source of truth that webhook, cron, and reconciliation all read,
  //    preventing divergent obligation IDs when endAt changes between reads.
  await db.subscription.update({
    where: { id: params.subscriptionId },
    data: {
      billingObligationId: canonicalObligationId(params.subscriptionId, resultingEndAt!.getTime()),
    },
  });

  return { applied: true, subscription: updatedSub! };
}

export { applyEntitlementIfNotApplied };

/**
 * Derives the canonical billing obligation ID from a subscription and period.
 *
 * Format: obligation_<subscriptionId>_<periodEpoch>
 *
 * This is shared by webhook, cron, and reconciliation so all paths resolve
 * to the same identity for the same billing obligation:
 *   obligation_sub-1_1234567890
 *
 * Use this instead of deriving obligation identity from provider references
 * (`pp_<uuid>` vs `renew_<sub.id>_<periodEpoch>_attN`), which are path-specific
 * and do not converge.
 */
export function canonicalObligationId(
  subscriptionId: string,
  periodEpoch: number,
): string {
  return `obligation_${subscriptionId}_${periodEpoch}`;
}

/**
 * Legacy helper: strips attempt suffixes (`_attN`) from provider references.
 *
 * Kept for backward compatibility with `initializePayment`, which sets the
 * initial `obligationId` on a pending transaction before any subscription or
 * period is known. This legacy value is corrected to the canonical form
 * (`obligation_<subscriptionId>_<periodEpoch>`) by callers of
 * `applyEntitlementIfNotApplied` once the subscription and period are known.
 *
 * Do NOT use this for entitlement deduplication — it does not converge across
 * webhook and cron paths.
 */
export function canonicalObligationIdFromReference(
  providerReference: string,
): string {
  return providerReference.replace(/_att\d+$/, '');
}

export async function cancelAutoRenew(userId: string) {
  const sub = await prisma.subscription.findFirst({ where: { userId, status: 'active' }, orderBy: { endAt: 'desc' } });
  if (!sub) throw new ApiError(400, 'No active subscription');
  // Access persists until endAt — only future renewals stop.
  return prisma.subscription.update({ where: { id: sub.id }, data: { autoRenew: false } });
}

export function verifyPaystackSignature(rawBody: string, signature: string | null): boolean {
  if (!signature) return false;
  try {
    requirePaystack();
  } catch {
    return false;
  }
  const expected = crypto.createHmac('sha512', getEnv().PAYSTACK_SECRET_KEY!).update(rawBody).digest('hex');
  return timingSafeStringEqual(expected, signature);
}

export function verifyFlutterwaveSignature(hash: string | null): boolean {
  if (!hash) return false;
  try {
    requireFlutterwave();
  } catch {
    return false;
  }
  return timingSafeStringEqual(hash, getEnv().FLUTTERWAVE_WEBHOOK_SECRET_HASH!);
}
