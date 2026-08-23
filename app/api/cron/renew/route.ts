import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { resolvePrice, toMinorUnits } from '@/lib/payments';
import { paystackChargeAuthorization } from '@/lib/providers/paystack';
import { flutterwaveChargeToken } from '@/lib/providers/flutterwave';
import { sendRenewalReminderEmail, getAppUrl } from '@/lib/email';
import { timingSafeStringEqual } from '@/lib/timing-safe';
import { decryptPaymentToken } from '@/lib/encryption';
import { getRequestId } from '@/lib/request-id';
import { isValidSubscriptionTransition } from '@/lib/subscription-state';

export const runtime = 'nodejs';
export const maxDuration = 60;

const LOOKAHEAD_HOURS = 24; // pick up renewals due within the next 24h, plus any still in a retry grace period
const MAX_RENEWAL_ATTEMPTS = 3;
// Configurable lease timeout for stuck 'processing' renewals (defaults to 15 minutes / 900 seconds)
const RENEWAL_LOCK_TIMEOUT_SECONDS = Number(process.env.RENEWAL_LOCK_TIMEOUT_SECONDS ?? 15 * 60);

/**
 * Replaces NestJS's @Cron(EVERY_DAY_AT_2AM) RenewalCron. vercel.json declares
 * the schedule; Vercel injects `Authorization: Bearer $CRON_SECRET` on the
 * request, verified below.
 *
 * Concurrency & Race-Condition Safety:
 * - Employs an atomic renewal-locking state machine (idle -> processing -> idle/failed)
 *   via conditional updateMany with row-level database atomicity.
 * - Enforces deterministic reference generation per billing period/attempt so that
 *   concurrent or retried charges never create divergent charge requests.
 * - Leases on stuck 'processing' records safely expire after RENEWAL_LOCK_TIMEOUT_SECONDS.
 *
 * Retry policy (design doc Section 5.3 / PRD Section 9): a subscription
 * whose charge fails is NOT expired immediately — it stays `active` (user
 * keeps access) with `renewalAttempts` incremented and `renewalStatus: 'failed'`,
 * and gets picked up again on the next daily run since its `endAt` hasn't moved.
 * Only after MAX_RENEWAL_ATTEMPTS consecutive failures does it get marked `expired`.
 */
export async function GET(req: NextRequest) {
  const requestId = getRequestId(req);
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !authHeader || !timingSafeStringEqual(authHeader, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const staleLockThreshold = new Date(now.getTime() - RENEWAL_LOCK_TIMEOUT_SECONDS * 1000);

  // 1. Query subscriptions due for renewal that are not actively leased by another process
  const dueSubs = await prisma.subscription.findMany({
    where: {
      status: 'active',
      autoRenew: true,
      endAt: { lte: cutoff },
      OR: [
        { renewalStatus: 'idle' },
        { renewalStatus: 'failed' },
        {
          renewalStatus: 'processing',
          renewalLockedAt: { lt: staleLockThreshold },
        },
      ],
    },
    include: { plan: true, user: true },
  });

  const results = { renewed: 0, retriesScheduled: 0, expired: 0, remindersSent: 0, errors: [] as string[] };

  for (const sub of dueSubs) {
    // Defensive: `plan`/`user` are foreign keys, but malformed rows should be
    // logged and skipped rather than crashing the batch.
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

      // Send at most one reminder per subscription — renewalReminderSentAt is the dedupe marker
      if (!sub.renewalReminderSentAt) {
        try {
          const renewalUrl = `${getAppUrl()}/dashboard/plans`;
          await sendRenewalReminderEmail(
            sub.user.email,
            renewalUrl,
            sub.plan.name,
            sub.endAt.toDateString(),
          );
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

    // 2. Deterministic payment reference: tied strictly to subscription ID, period end date, and attempt number
    const nextAttempt = sub.renewalAttempts + 1;
    const periodEpoch = sub.endAt.getTime();
    const reference = `renew_${sub.id}_${periodEpoch}_att${nextAttempt}`;

    // 3. ATOMIC CLAIM: conditionally claim the renewal lock in the database.
    // If another concurrent cron or background worker claimed it first, claim.count will be 0.
    const claim = await prisma.subscription.updateMany({
      where: {
        id: sub.id,
        status: 'active',
        autoRenew: true,
        OR: [
          { renewalStatus: 'idle' },
          { renewalStatus: 'failed' },
          {
            renewalStatus: 'processing',
            renewalLockedAt: { lt: staleLockThreshold },
          },
        ],
      },
      data: {
        renewalStatus: 'processing',
        renewalLockedAt: now,
        renewalReference: reference,
      },
    });

    if (claim.count === 0) {
      // Another worker/cron execution claimed this subscription concurrently — skip
      continue;
    }

    const plan = sub.plan;
    const subUser = sub.user;

    try {
      // 4. Idempotency safeguard: check if a successful transaction already exists for this reference
      const existingTx = await prisma.transaction.findUnique({
        where: { providerReference: reference },
      });

      if (existingTx && existingTx.status === 'success') {
        const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
        const newEnd = new Date(Math.max(sub.endAt.getTime(), now.getTime()) + durationMs);
        await prisma.subscription.update({
          where: { id: sub.id },
          data: {
            endAt: newEnd,
            renewalAttempts: 0,
            lastRenewalError: null,
            renewalReminderSentAt: null,
            renewalStatus: 'idle',
            renewalLockedAt: null,
            renewalReference: null,
          },
        });
        results.renewed++;
        continue;
      }

      // 5. Execute charge against payment provider with deterministic reference
      const { amount, currency, fxRateUsed } = await resolvePrice(plan, subUser.country);

      // Decrypt stored authorization code / card token immediately before provider request
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

      if (!chargeResult.success) throw new Error('Charge declined by provider');

      // 6. Charge succeeded: persist transaction and advance subscription atomically
      await prisma.$transaction(async (db) => {
        await db.transaction.create({
          data: {
            userId: sub.userId,
            subscriptionId: sub.id,
            provider: sub.renewalProvider!,
            providerReference: reference,
            idempotencyKey: crypto.randomUUID(),
            amount,
            currency,
            fxRateUsed,
            status: 'success',
            completedAt: now,
            rawPayload: chargeResult.raw as any,
          },
        });

        const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
        const newEnd = new Date(Math.max(sub.endAt.getTime(), now.getTime()) + durationMs);
        await db.subscription.update({
          where: { id: sub.id },
          data: {
            endAt: newEnd,
            renewalAttempts: 0,
            lastRenewalError: null,
            renewalReminderSentAt: null,
            renewalStatus: 'idle',
            renewalLockedAt: null,
            renewalReference: null,
          },
        });
      });

      results.renewed++;
    } catch (err) {
      const message = (err as Error).message;
      const attempts = sub.renewalAttempts + 1;

      if (attempts >= MAX_RENEWAL_ATTEMPTS) {
        if (!isValidSubscriptionTransition(sub.status, 'expired')) {
          results.errors.push(`sub ${sub.id}: invalid transition from ${sub.status} to expired`);
          continue;
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
      } else {
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
        results.retriesScheduled++;
      }

      results.errors.push(`sub ${sub.id}: ${message}`);
    }
  }

  return withRequestId(req, NextResponse.json(results));
}

function withRequestId(req: NextRequest, res: NextResponse): NextResponse {
  const requestId = getRequestId(req);
  res.headers.set('x-request-id', requestId);
  return res;
}
