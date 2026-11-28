import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolvePrice, toMinorUnits, extractPzProviderTransactionId, extractFwProviderTransactionId, applyEntitlementIfNotApplied, canonicalObligationId } from '@/lib/payments';
import {
  paystackChargeAuthorization,
  paystackVerifyTransaction,
} from '@/lib/providers/paystack';
import {
  flutterwaveChargeToken,
  flutterwaveVerifyTransaction,
} from '@/lib/providers/flutterwave';
import { sendRenewalReminderEmail, getAppUrl } from '@/lib/email';
import { timingSafeStringEqual } from '@/lib/timing-safe';
import { decryptPaymentToken } from '@/lib/encryption';
import { getRequestId } from '@/lib/request-id';
import { isValidSubscriptionTransition } from '@/lib/subscription-state';
import type { PaymentProvider } from '@prisma/client';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LOOKAHEAD_HOURS = 24; // pick up renewals due within the next 24h, plus any still in a retry grace period
const MAX_RENEWAL_ATTEMPTS = 3; // DEFINITIVE-failure budget only (unknown outcomes never consume it)
// Parse a positive integer env var (seconds). Missing/invalid (NaN/Infinity/<=0)
// falls back to a safe default so a bad config can never disable or pin the
// throttle/lease.
function envPositiveSeconds(name: string, defaultSeconds: number): number {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultSeconds;
}
// Operational bound for the INITIAL (high-frequency) reconciliation window.
// After this window the cron keeps reconciling, but at a lower frequency
// (RECOVERY_INTERVAL_MS) so an unresolved payment is never permanently stranded.
const RECONCILE_MAX_AGE_MS = envPositiveSeconds('RENEWAL_RECONCILE_MAX_AGE_SECONDS', 7 * 24 * 60 * 60) * 1000;
// Lower-frequency recovery cadence applied AFTER the initial window. Bounds how
// often providers are called, not the ability to eventually recover.
const RECOVERY_INTERVAL_MS = envPositiveSeconds('RENEWAL_RECOVERY_INTERVAL_SECONDS', 6 * 60 * 60) * 1000;
// Configurable lease timeout for stuck 'processing' renewals (defaults to 15 minutes / 900 seconds)
const RENEWAL_LOCK_TIMEOUT_SECONDS = envPositiveSeconds('RENEWAL_LOCK_TIMEOUT_SECONDS', 15 * 60);

/**
 * Renewal cron with F-02 protections.
 *
 * Outcome classes (kept strictly separate):
 *  - DEFINITIVE provider rejection: the provider replied and no charge occurred
 *    → consumes the normal retry budget (renewalAttempts), may expire at MAX.
 *  - UNKNOWN provider outcome (pending / verification unavailable / timeout):
 *    → NEVER consumes the retry budget, NEVER auto-expires; enters
 *      `reconciliation_required` with the reference preserved.
 *  - Successful charge with failed DB persistence: treated as UNKNOWN (the money
 *    may have moved) → reconciliation_required, no attempt consumed, no re-charge.
 *
 * A reclaimed stale `processing` row (previous outcome unknown) is ALWAYS
 * reconciled (verify by the original reference) before any charge is considered.
 * The stable reference is reused across retries so the provider sees one identity.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !authHeader || !timingSafeStringEqual(authHeader, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const staleLockThreshold = new Date(now.getTime() - RENEWAL_LOCK_TIMEOUT_SECONDS * 1000);

  // 1. Query subscriptions due for renewal that are not actively leased by another process.
  //    `reconciliation_required` is always discoverable (never hidden by expiry).
  const dueSubs = await prisma.subscription.findMany({
    where: {
      status: 'active',
      autoRenew: true,
      endAt: { lte: cutoff },
      OR: [
        { renewalStatus: 'idle' },
        { renewalStatus: 'failed' },
        { renewalStatus: 'reconciliation_required' },
        {
          renewalStatus: 'processing',
          updatedAt: { lt: staleLockThreshold },
        },
      ],
    },
    include: { plan: true, user: true },
  });

  const results = {
    renewed: 0,
    reconciled: 0,
    retriesScheduled: 0,
    expired: 0,
    remindersSent: 0,
    errors: [] as string[],
  };

  for (const sub of dueSubs) {
    if (!sub.plan || !sub.user) {
      results.errors.push(`sub ${sub.id}: missing plan or user relation — skipped`);
      continue;
    }

    // No stored payment method (e.g. initial charge didn't return a reusable token).
    if (!sub.renewalAuthCode || !sub.renewalProvider) {
      const alreadyExpired = sub.endAt <= now;

      if (alreadyExpired) {
        if (!isValidSubscriptionTransition(sub.status, 'expired')) {
          results.errors.push(`sub ${sub.id}: invalid transition from ${sub.status} to expired`);
          continue;
        }
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired', renewalStatus: 'failed', renewalLockedAt: null },
        });
        results.expired++;
        continue;
      }

      if (!sub.renewalReminderSentAt) {
        try {
          const renewalUrl = `${getAppUrl()}/dashboard/plans`;
          await sendRenewalReminderEmail(sub.user.email, renewalUrl, sub.plan.name, sub.endAt.toDateString());
          results.remindersSent++;
        } catch (emailErr) {
          results.errors.push(`sub ${sub.id}: reminder email failed — ${(emailErr as Error).message}`);
        }
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { renewalReminderSentAt: now, renewalStatus: 'idle', renewalLockedAt: null },
        });
      }
      continue;
    }

    const plan = sub.plan;
    const subUser = sub.user;
    const periodEpoch = sub.endAt.getTime();
    const reference = stableRenewalReference(sub, periodEpoch);
    const priorStatus = sub.renewalStatus;

    // 2. POST-WINDOW THROTTLE. During the initial reconciliation window
    //    (anchor age <= RECONCILE_MAX_AGE_MS) we reconcile on every run. After it
    //    we reconcile at most once per RECOVERY_INTERVAL_MS. The ANCHOR is
    //    `renewalLockedAt` (first-uncertain time, preserved); the last attempt is
    //    `updatedAt`. Throttled rows are skipped BEFORE the claim so `updatedAt`
    //    is not refreshed. Recovery is never permanently disabled and an
    //    unresolved payment is never auto-expired.
    if (priorStatus === 'reconciliation_required' && sub.renewalLockedAt) {
      const anchorAge = now.getTime() - sub.renewalLockedAt.getTime();
      if (anchorAge > RECONCILE_MAX_AGE_MS) {
        const lastAttempt = sub.updatedAt ? sub.updatedAt.getTime() : sub.renewalLockedAt.getTime();
        if (now.getTime() - lastAttempt < RECOVERY_INTERVAL_MS) {
          continue; // throttled — remain reconciliation_required, no provider call
        }
      }
    }

    // 3. ATOMIC CLAIM. The exclusive LEASE is `updatedAt` (Prisma sets it to now
    //    on this update); the stale-processing clause keys on `updatedAt`, so a
    //    freshly-claimed row is NOT immediately re-claimable by a concurrent
    //    worker. `renewalLockedAt` is preserved as the reconciliation anchor.
    const claim = await prisma.subscription.updateMany({
      where: {
        id: sub.id,
        status: 'active',
        autoRenew: true,
        OR: [
          { renewalStatus: 'idle' },
          { renewalStatus: 'failed' },
          { renewalStatus: 'reconciliation_required' },
          {
            renewalStatus: 'processing',
            updatedAt: { lt: staleLockThreshold },
          },
        ],
      },
      data: {
        renewalStatus: 'processing',
        // Preserve the reconciliation anchor (first-uncertain time) for the
        // post-window throttle; the exclusive LEASE is `updatedAt` (set to now by
        // Prisma on this update), so a freshly-claimed row is not stale.
        renewalLockedAt: priorStatus === 'reconciliation_required' ? sub.renewalLockedAt : now,
        renewalReference: reference,
      },
    });

    if (claim.count === 0) {
      // Another worker/cron execution claimed this subscription concurrently — skip.
      continue;
    }

    try {
      // Expected renewal price (amount + currency) for this plan/country. Computed
      // once and reused for both charge and post-verification validation. Inside
      // the try so an FX/price failure is treated as an uncertain outcome.
      const { amount, currency, fxRateUsed } = await resolvePrice(plan, subUser.country);
      const fxRateUsedNull = fxRateUsed ?? null;

      // 3. Idempotency safeguard: a successful transaction for this stable
      //    reference means the charge already happened — advance, never re-charge.
      const existingTx = await prisma.transaction.findUnique({
        where: { providerReference: reference },
      });

      if (existingTx && existingTx.status === 'success') {
        await applyRenewalSuccess(sub, plan, reference, now, existingTx.rawPayload, sub.renewalProvider);
        results.renewed++;
        continue;
      }

      // 4. Reconcile an uncertain prior outcome BEFORE any charge. A reclaimed
      //    stale `processing` row, a `reconciliation_required` row, or a
      //    non-success transaction row all mean the previous outcome is unknown.
      const mustReconcile =
        priorStatus === 'reconciliation_required' || priorStatus === 'processing' || !!existingTx;

      if (mustReconcile) {
        // Reconcile an uncertain prior outcome. The initial window is
        // high-frequency; after it, the pre-claim throttle (above) bounds the
        // cadence. Reconciliation is never permanently disabled and an
        // unresolved payment is never auto-expired.
        const { outcome, raw, record } = await verifyRenewal(sub.renewalProvider, reference);
        if (outcome === 'success') {
          const check = validateRenewalRecord(record, { reference, amount, currency, email: subUser.email });
          if (!check.ok) {
            // Verified-but-mismatched (or unrelated) record: do NOT grant
            // entitlement and do NOT treat as a definitive failure. Preserve the
            // reference and keep the payment unresolved for reconciliation.
            await enterReconciliation(sub, reference, `verification mismatch: ${check.reason}`, results);
            results.retriesScheduled++;
            continue;
          }
          await applyRenewalSuccess(sub, plan, reference, now, raw, sub.renewalProvider);
          results.reconciled++;
          continue;
        }
        if (outcome === 'unknown') {
          await enterReconciliation(sub, reference, 'provider outcome unknown', results);
          results.retriesScheduled++;
          continue;
        }
        // outcome === 'failed' → provider confirms NO charge occurred.
        if (priorStatus === 'processing' && !existingTx) {
          // Stale attempt never charged → safe to charge now (same reference).
          // Fall through to the charge block below.
        } else {
          await applyDefinitiveFailure(sub, 'provider confirmed failure', results);
          results.retriesScheduled++;
          continue;
        }
      }

      // 5. Execute charge against the provider with the stable reference.
      const decryptedAuthCode = sub.renewalAuthCode.startsWith('v1:')
        ? decryptPaymentToken(sub.renewalAuthCode)
        : sub.renewalAuthCode;

      const chargeResult =
        sub.renewalProvider === 'paystack'
          ? await paystackChargeAuthorization({
              email: subUser.email,
              amountMinorUnits: toMinorUnits(amount, currency),
              currency,
              authorizationCode: decryptedAuthCode,
              reference,
            })
          : await flutterwaveChargeToken({
              token: decryptedAuthCode,
              amount,
              currency,
              email: subUser.email,
              txRef: reference,
            });

      if (!chargeResult.success) {
        // Decline OR duplicate-reference rejection (original may have succeeded).
        const { outcome, raw, record } = await verifyRenewal(sub.renewalProvider, reference);
        if (outcome === 'success') {
          const check = validateRenewalRecord(record, { reference, amount, currency, email: subUser.email });
          if (!check.ok) {
            await enterReconciliation(sub, reference, `verification mismatch: ${check.reason}`, results);
            results.retriesScheduled++;
            continue;
          }
          await applyRenewalSuccess(sub, plan, reference, now, raw, sub.renewalProvider);
          results.reconciled++;
          continue;
        }
        if (outcome === 'unknown') {
          await enterReconciliation(sub, reference, 'provider outcome unknown after decline', results);
          results.retriesScheduled++;
          continue;
        }
        await applyDefinitiveFailure(sub, 'provider declined', results);
        results.retriesScheduled++;
        continue;
      }

      // 6. Charge succeeded: persist transaction and advance subscription atomically.
      // Extract provider transaction ID for cross-path idempotency.
      const providerTransactionId =
        sub.renewalProvider === 'paystack'
          ? extractPzProviderTransactionId(chargeResult.raw)
          : extractFwProviderTransactionId(chargeResult.raw);

      // Resolve the canonical obligation identity from the subscription's
      // stored billingObligationId. This is immutable during a period's
      // lifetime and does not depend on the mutable endAt, so webhook and cron
      // always converge on the same identity for the same billing period.
      let obligationId = sub.billingObligationId;
      if (!obligationId) {
        // Legacy subscription without a stored obligation ID: derive from the
        // current endAt (start of the new period) and persist it within the
        // transaction below.
        obligationId = canonicalObligationId(sub.id, sub.endAt.getTime());
      }

      await prisma.$transaction(async (db) => {
        // Persist the obligation ID on the subscription if it wasn't already set.
        if (!sub.billingObligationId) {
          await db.subscription.update({
            where: { id: sub.id },
            data: { billingObligationId: obligationId },
          });
        }

        await applyEntitlementIfNotApplied(db, {
          userId: sub.userId,
          subscriptionId: sub.id,
          plan: { id: plan.id, durationDays: plan.durationDays },
          provider: sub.renewalProvider!,
          providerReference: reference,
          obligationId,
          providerTransactionId,
          amount,
          currency,
          fxRateUsed: fxRateUsedNull,
          renewalToken: null, // Cron doesn't receive new renewal token from charge
          rawPayload: chargeResult.raw,
          now,
        });
      });

      results.renewed++;
    } catch (err) {
      // UNCERTAIN OUTCOME (charge may have succeeded but the local commit failed,
      // or the network failed mid-request). Do NOT consume the definitive-failure
      // budget and do NOT charge again now. Preserve the reference and enter the
      // (time-bounded) reconciliation state.
      const message = (err as Error).message;
      await enterReconciliation(sub, reference, message, results);
      results.errors.push(`sub ${sub.id}: ${message}`);
    }
  }

  return withRequestId(req, NextResponse.json(results));
}

/**
 * Stable reference for the current billing period. Reuses the stored reference
 * for this exact period (retry/reconciliation); the attempt suffix only advances
 * on definitive failure (when no reference is stored).
 */
function stableRenewalReference(
  sub: { id: string; renewalReference: string | null; renewalAttempts: number },
  periodEpoch: number,
): string {
  const prefix = `renew_${sub.id}_${periodEpoch}_`;
  if (sub.renewalReference && sub.renewalReference.startsWith(prefix)) {
    return sub.renewalReference;
  }
  return `${prefix}att${sub.renewalAttempts + 1}`;
}

async function applyRenewalSuccess(
  sub: any,
  plan: any,
  reference: string,
  now: Date,
  rawPayload: unknown,
  provider: PaymentProvider,
) {
  const { amount, currency, fxRateUsed } = await resolvePrice(plan, sub.user.country);
  const fxRateUsedNull = fxRateUsed ?? null;
  // Extract provider transaction ID from verification response for cross-path idempotency
  const providerTransactionId =
    provider === 'paystack'
      ? extractPzProviderTransactionId(rawPayload)
      : extractFwProviderTransactionId(rawPayload);

  // Resolve the canonical obligation identity from the subscription's
  // stored billingObligationId. This is immutable during a period's
  // lifetime and does not depend on the mutable endAt.
  let obligationId = sub.billingObligationId;
  if (!obligationId) {
    obligationId = canonicalObligationId(sub.id, sub.endAt.getTime());
  }

  await prisma.$transaction(async (db) => {
    if (!sub.billingObligationId) {
      await db.subscription.update({
        where: { id: sub.id },
        data: { billingObligationId: obligationId },
      });
    }

    await applyEntitlementIfNotApplied(db, {
      userId: sub.userId,
      subscriptionId: sub.id,
      plan: { id: plan.id, durationDays: plan.durationDays },
      provider,
      providerReference: reference,
      obligationId,
      providerTransactionId,
      amount,
      currency,
      fxRateUsed: fxRateUsedNull,
      renewalToken: null,
      rawPayload,
      now,
    });
  });
}

/**
 * Pure provider verification of an existing reference. Never mutates state.
 * Returns:
 *  - 'success' : provider returned a reliable, COMPLETE record confirming the
 *                charge succeeded (record carries reference/amount/currency).
 *  - 'failed'  : provider returned a reliable record confirming NO charge occurred.
 *  - 'unknown' : INCONCLUSIVE — HTTP 5xx, network/timeout, malformed/incomplete
 *                body, missing status, pending, or verification unavailable.
 *                Never treated as a definitive failure.
 * `record` is populated only for a conclusive response so the caller can validate
 * it against the expected renewal details before granting entitlement.
 */
async function verifyRenewal(
  provider: PaymentProvider,
  reference: string,
): Promise<{
  outcome: 'success' | 'failed' | 'unknown';
  raw: unknown;
  record: { reference: string; amount: number; currency: string; customerEmail?: string } | null;
}> {
  let conclusive = false;
  let verified = false;
  let status = 'unknown';
  let raw: unknown = null;
  let record: { reference: string; amount: number; currency: string; customerEmail?: string } | null = null;
  try {
    if (provider === 'paystack') {
      const v = await paystackVerifyTransaction({ reference });
      conclusive = v.conclusive;
      verified = v.verified;
      status = v.status;
      raw = v.raw;
      record = { reference: v.reference, amount: v.amount, currency: v.currency, customerEmail: v.customerEmail };
    } else {
      const v = await flutterwaveVerifyTransaction({ txRef: reference });
      conclusive = v.conclusive;
      verified = v.verified;
      status = v.status;
      raw = v.raw;
      record = { reference: v.txRef, amount: v.amount, currency: v.currency, customerEmail: v.customerEmail };
    }
  } catch {
    // Network/timeout/connection failure → INCONCLUSIVE (never proof of failure).
    return { outcome: 'unknown', raw: null, record: null };
  }

  // A non-conclusive response (5xx, malformed, missing/partial record, or a
  // record for a different reference) is UNKNOWN.
  if (!conclusive) {
    return { outcome: 'unknown', raw, record: null };
  }

  if (verified && (status === 'success' || status === 'successful')) {
    return { outcome: 'success', raw, record };
  }
  // A reliable record whose status is an explicit non-success terminal state.
  if (status === 'failed' || status === 'cancelled' || status === 'abandoned' || status === 'reversed') {
    return { outcome: 'failed', raw, record: null };
  }
  // Reliable record but pending/other → still unknown.
  return { outcome: 'unknown', raw, record: null };
}

/**
 * Validate a conclusively-verified record against the expected renewal details
 * BEFORE any entitlement is granted. Mirrors the canonical match rule used by
 * the webhook path (lib/payments.ts:196-199): amount to 2dp, exact currency,
 * and customer email when both sides provide one. A mismatch is NOT a definitive
 * failure — the caller routes it to reconciliation.
 */
function validateRenewalRecord(
  record: { reference: string; amount: number; currency: string; customerEmail?: string } | null,
  expected: { reference: string; amount: number; currency: string; email: string },
): { ok: true } | { ok: false; reason: string } {
  if (!record) return { ok: false, reason: 'missing transaction record' };
  if (!record.reference || record.reference !== expected.reference) {
    return { ok: false, reason: 'reference mismatch' };
  }
  if (!Number.isFinite(record.amount) || record.amount.toFixed(2) !== expected.amount.toFixed(2)) {
    return { ok: false, reason: 'amount mismatch' };
  }
  if (!record.currency || record.currency !== expected.currency) {
    return { ok: false, reason: 'currency mismatch' };
  }
  if (
    record.customerEmail &&
    expected.email &&
    record.customerEmail.toLowerCase().trim() !== expected.email.toLowerCase().trim()
  ) {
    return { ok: false, reason: 'customer mismatch' };
  }
  return { ok: true };
}

/** Enter/refresh the reconciliation state. Does NOT consume the definitive budget. */
async function enterReconciliation(sub: any, reference: string, message: string, results: { errors: string[] }) {
  // Anchor the reconciliation window to the FIRST uncertain outcome. Once in
  // `reconciliation_required`, keep the original anchor so RECONCILE_MAX_AGE_MS
  // can eventually elapse instead of being refreshed on every run.
  const anchor =
    sub.renewalStatus === 'reconciliation_required' && sub.renewalLockedAt
      ? sub.renewalLockedAt
      : new Date();
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      lastRenewalError: message,
      renewalStatus: 'reconciliation_required',
      renewalLockedAt: anchor,
      renewalReference: reference,
    },
  });
  results.errors.push(`sub ${sub.id}: ${message}`);
}

/** Definitive provider failure: consume the retry budget; expire only at MAX. */
async function applyDefinitiveFailure(
  sub: any,
  message: string,
  results: { expired: number; errors: string[] },
) {
  const attempts = sub.renewalAttempts + 1;
  if (attempts >= MAX_RENEWAL_ATTEMPTS) {
    await expireSubscription(sub, attempts, message, results);
    return;
  }
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      renewalAttempts: attempts,
      lastRenewalError: message,
      renewalStatus: 'failed',
      renewalLockedAt: null,
      renewalReference: null,
    },
  });
}

async function expireSubscription(
  sub: any,
  attempts: number,
  message: string,
  results: { expired: number; errors: string[] },
) {
  if (!isValidSubscriptionTransition(sub.status, 'expired')) {
    results.errors.push(`sub ${sub.id}: invalid transition from ${sub.status} to expired`);
    return;
  }
  await prisma.subscription.update({
    where: { id: sub.id },
    data: {
      status: 'expired',
      autoRenew: false,
      renewalAttempts: attempts,
      lastRenewalError: message,
      renewalStatus: 'failed',
      renewalLockedAt: null,
      renewalReference: null,
    },
  });
  results.expired++;
}

function withRequestId(req: NextRequest, res: NextResponse): NextResponse {
  const requestId = getRequestId(req);
  res.headers.set('x-request-id', requestId);
  return res;
}