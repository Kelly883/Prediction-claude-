import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';
import { prisma } from '@/lib/prisma';
import { resolvePrice, toMinorUnits } from '@/lib/payments';
import { paystackChargeAuthorization } from '@/lib/providers/paystack';
import { flutterwaveChargeToken } from '@/lib/providers/flutterwave';
import { sendEmail } from '@/lib/email';
import { timingSafeStringEqual } from '@/lib/timing-safe';
export const runtime = 'nodejs';
export const maxDuration = 60;

const LOOKAHEAD_HOURS = 24; // pick up renewals due within the next 24h, plus any still in a retry grace period
const MAX_RENEWAL_ATTEMPTS = 3;

/**
 * Replaces NestJS's @Cron(EVERY_DAY_AT_2AM) RenewalCron. vercel.json declares
 * the schedule; Vercel injects `Authorization: Bearer $CRON_SECRET` on the
 * request, verified below.
 *
 * Retry policy (design doc Section 5.3 / PRD Section 9): a subscription
 * whose charge fails is NOT expired immediately — it stays `active` (user
 * keeps access) with `renewalAttempts` incremented, and gets picked up again
 * on the next daily run since its `endAt` hasn't moved. Only after
 * MAX_RENEWAL_ATTEMPTS consecutive failures does it get marked `expired`.
 */
export async function GET(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const expected = `Bearer ${process.env.CRON_SECRET}`;
  if (!process.env.CRON_SECRET || !authHeader || !timingSafeStringEqual(authHeader, expected)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const cutoff = new Date(now.getTime() + LOOKAHEAD_HOURS * 60 * 60 * 1000);
  const dueSubs = await prisma.subscription.findMany({
    where: { status: 'active', autoRenew: true, endAt: { lte: cutoff } },
    include: { plan: true, user: true },
  });

  const results = { renewed: 0, retriesScheduled: 0, expired: 0, remindersSent: 0, errors: [] as string[] };

  for (const sub of dueSubs) {
    // Defensive: `plan`/`user` are foreign keys, so this should be
    // impossible under normal operation — but this cron runs unattended
    // with no human watching, so a malformed row should be logged and
    // skipped rather than crashing the whole batch (and taking every other
    // subscription's renewal down with it).
    if (!sub.plan || !sub.user) {
      results.errors.push(`sub ${sub.id}: missing plan or user relation — skipped`);
      continue;
    }

    // No stored payment method (e.g. the original charge didn't return a
    // reusable authorization). There's nothing to auto-charge, but that's
    // not the same as "renewal failed" — give the person a heads-up and a
    // grace period to renew manually instead of expiring them the instant
    // this cron happens to run within the lookahead window.
    if (!sub.renewalAuthCode || !sub.renewalProvider) {
      const alreadyExpired = sub.endAt <= now;

      if (alreadyExpired) {
        await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'expired' } });
        results.expired++;
        continue;
      }

      // Send at most one reminder per subscription — renewalReminderSentAt
      // is the dedupe marker, since this cron may see the same subscription
      // on consecutive days while it's still within the lookahead window.
      if (!sub.renewalReminderSentAt) {
        try {
          await sendEmail({
            to: sub.user.email,
            subject: 'Your PredictPro plan is expiring soon',
            html: `<p>Your ${sub.plan.name} plan ends on ${sub.endAt.toDateString()} and we don't have a payment method on file to renew it automatically.</p><p>Renew manually before then to keep access: <a href="${process.env.APP_URL}/dashboard/plans">${process.env.APP_URL}/dashboard/plans</a></p>`,
          });
          results.remindersSent++;
        } catch (emailErr) {
          // Don't let a misconfigured email provider block the rest of the
          // batch — log and move on, same as any other per-subscription error.
          results.errors.push(`sub ${sub.id}: reminder email failed — ${(emailErr as Error).message}`);
        }
        await prisma.subscription.update({ where: { id: sub.id }, data: { renewalReminderSentAt: now } });
      }
      continue;
    }

    const reference = `renew_${sub.id}_${Date.now()}`;
    const plan = sub.plan; // narrowed above, but TS can't see through the $transaction closure below — capture explicitly
    const subUser = sub.user;

    try {
      const { amount, currency, fxRateUsed } = await resolvePrice(plan, subUser.country);

      const chargeResult =
        sub.renewalProvider === 'paystack'
          ? await paystackChargeAuthorization({
              email: subUser.email,
              amountMinorUnits: toMinorUnits(amount, currency),
              currency,
              authorizationCode: sub.renewalAuthCode,
              reference,
            })
          : await flutterwaveChargeToken({
              token: sub.renewalAuthCode,
              amount,
              currency,
              email: subUser.email,
              txRef: reference,
            });

      if (!chargeResult.success) throw new Error('Charge declined by provider');

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
            rawPayload: chargeResult.raw as any,
          },
        });

        const durationMs = plan.durationDays * 24 * 60 * 60 * 1000;
        const newEnd = new Date(Math.max(sub.endAt.getTime(), now.getTime()) + durationMs);
        await db.subscription.update({
          where: { id: sub.id },
          data: { endAt: newEnd, renewalAttempts: 0, lastRenewalError: null, renewalReminderSentAt: null },
        });
      });

      results.renewed++;
    } catch (err) {
      const message = (err as Error).message;
      const attempts = sub.renewalAttempts + 1;

      if (attempts >= MAX_RENEWAL_ATTEMPTS) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'expired', autoRenew: false, renewalAttempts: attempts, lastRenewalError: message },
        });
        results.expired++;
      } else {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { renewalAttempts: attempts, lastRenewalError: message },
        });
        results.retriesScheduled++;
      }

      results.errors.push(`sub ${sub.id}: ${message}`);
    }
  }

  return NextResponse.json(results);
}
