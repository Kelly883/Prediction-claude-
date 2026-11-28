// =============================================================================
// Phase 1D.13: Database-Enforced Entitlement Idempotency — Real PostgreSQL
// Integration Tests
// =============================================================================
// Providers are MOCKED (no live Paystack/Flutterwave calls). The DATABASE is
// REAL PostgreSQL via TEST_DATABASE_URL. These tests exercise DB-level
// uniqueness constraints and atomic expiry updates against live Postgres.
//
// REQUIRES: TEST_DATABASE_URL environment variable pointing to an isolated
// test database. If not set, the tests below are skipped.
//
// =============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Only use the real Prisma client when a test database is configured.
// Otherwise these tests are skipped (no in-memory substitution for real-DB
// concurrency evidence).
const testDatabaseUrl = process.env.TEST_DATABASE_URL?.trim();
const runRealDbTests = Boolean(testDatabaseUrl);

if (runRealDbTests) {
  process.env.DATABASE_URL = testDatabaseUrl;
  process.env.DIRECT_URL = testDatabaseUrl;
  // Increase interactive transaction timeout to 60 seconds (Neon default is 5s)
  const separator = testDatabaseUrl.includes('?') ? '&' : '?';
  if (!testDatabaseUrl.includes('options=')) {
    process.env.DATABASE_URL += `${separator}options=-c%20idle_in_transaction_session_timeout%3D60000`;
  }
  process.env.INTEGRATION_TEST = 'true';
  (process.env as any).NODE_ENV = 'test';
  process.env.APP_URL = 'http://localhost:3000';
  process.env.CRON_SECRET = 'test-cron-secret-at-least-32-characters-long-ok';
  process.env.PAYSTACK_SECRET_KEY = 'test-paystack-secret';
  process.env.FLUTTERWAVE_SECRET_KEY = 'test-flutterwave-secret';
  process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = 'test-flutterwave-hash';
  process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-bytes-long-ok';
  process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-bytes';
  process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = 'a'.repeat(64);
  process.env.TOTP_ENCRYPTION_KEY = 'b'.repeat(64);
  process.env.ENCRYPTION_KEY = 'c'.repeat(64);
  process.env.ADMIN_BOOTSTRAP_SECRET = 'test-admin-bootstrap-secret-32-chars';
  process.env.RESEND_API_KEY = 'test-resend-key';
  process.env.RESEND_FROM_EMAIL = 'test@example.com';
  process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900';
}

vi.mock('@/lib/providers/paystack', () => ({
  paystackChargeAuthorization: vi.fn(),
  paystackVerifyTransaction: vi.fn(),
  extractProviderTransactionId: vi.fn((raw) => raw?.data?.id ?? null),
}));
vi.mock('@/lib/providers/flutterwave', () => ({
  flutterwaveChargeToken: vi.fn(),
  flutterwaveVerifyTransaction: vi.fn(),
  extractProviderTransactionId: vi.fn((raw) => raw?.data?.id ?? null),
}));

import { prisma } from '@/lib/prisma';
import { canonicalObligationId, canonicalObligationIdFromReference, applyEntitlementIfNotApplied } from '@/lib/payments';
import { paystackChargeAuthorization, paystackVerifyTransaction } from '@/lib/providers/paystack';
import { flutterwaveChargeToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';

const chargePz = paystackChargeAuthorization as unknown as ReturnType<typeof vi.fn>;
const verifyPz = paystackVerifyTransaction as unknown as ReturnType<typeof vi.fn>;
const chargeFlw = flutterwaveChargeToken as unknown as ReturnType<typeof vi.fn>;
const verifyFlw = flutterwaveVerifyTransaction as unknown as ReturnType<typeof vi.fn>;

const DAY = 24 * 60 * 60 * 1000;

let createdUsers: string[] = [];
let createdPlans: string[] = [];
let createdSubs: string[] = [];

function uniqueEmail(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@example.com`;
}

async function createUser(email: string) {
  const u = await prisma.user.create({
    data: { email, name: 'Test User', passwordHash: 'x', country: 'NG' },
  });
  createdUsers.push(u.id);
  return u;
}

async function createPlan(durationDays = 30, priceNGN = 5000) {
  const p = await prisma.plan.create({
    data: {
      id: `plan-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'VIP',
      durationDays,
      priceNGN: priceNGN as any,
    },
  });
  createdPlans.push(p.id);
  return p;
}

function refFor(subId: string, periodEpoch: number): string {
  return `renew_${subId}_${periodEpoch}_att1`;
}

function obligIdFor(subId: string, periodEpoch: number): string {
  return canonicalObligationId(subId, periodEpoch);
}

async function createSubscription(
  userId: string,
  planId: string,
  overrides: any = {},
) {
  const endAt = overrides.endAt ?? new Date(Date.now() + 60 * 60 * 1000);
  const s = await prisma.subscription.create({
    data: {
      userId,
      planId,
      status: 'active',
      autoRenew: true,
      startAt: new Date(),
      endAt,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_test_123',
      renewalAttempts: 0,
      renewalStatus: overrides.renewalStatus ?? 'idle',
      renewalLockedAt: overrides.renewalLockedAt ?? null,
      renewalReference: overrides.renewalReference ?? null,
    },
  });
  createdSubs.push(s.id);
  return s;
}

async function runCron() {
  const { GET } = await import('@/app/api/cron/renew/route');
  const req = new Request('http://localhost/api/cron/renew', {
    headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
  });
  const res = await GET(req as any);
  return { res, json: await res.json() };
}

async function cleanup() {
  // Aggressive cleanup: delete all test data (users with @example.com email)
  await prisma.transaction.deleteMany({ where: { user: { email: { endsWith: '@example.com' } } } }).catch(() => {});
  await prisma.subscription.deleteMany({ where: { user: { email: { endsWith: '@example.com' } } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { email: { endsWith: '@example.com' } } }).catch(() => {});
  await prisma.plan.deleteMany({ where: { name: 'VIP' } }).catch(() => {});
  createdSubs = [];
  createdUsers = [];
  createdPlans = [];
}

beforeEach(async () => {
  chargePz.mockReset().mockResolvedValue({ success: true, raw: { id: 1 } });
  verifyPz.mockReset().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
  chargeFlw.mockReset().mockResolvedValue({ success: true, raw: { id: 1 } });
  verifyFlw.mockReset().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
  if (runRealDbTests) await cleanup();
});

afterEach(async () => {
  if (runRealDbTests) await cleanup();
});

describe.skipIf(!runRealDbTests)('Phase 1D.13 canonical obligation identity', () => {
  it('strips _attN suffix from cron renewal references (legacy function)', () => {
    expect(canonicalObligationIdFromReference('renew_sub-1_1234567890_att1')).toBe('renew_sub-1_1234567890');
    expect(canonicalObligationIdFromReference('renew_sub-1_1234567890_att2')).toBe('renew_sub-1_1234567890');
    expect(canonicalObligationIdFromReference('pp_abc-123-def')).toBe('pp_abc-123-def');
  });

  it('computes canonical obligation ID from subscription + period', () => {
    expect(canonicalObligationId('sub-1', 1234567890)).toBe('obligation_sub-1_1234567890');
  });
});

describe.skipIf(!runRealDbTests)('Phase 1D.13 real-DB: cross-path entitlement idempotency', () => {
  it('webhook wins; cron processes same obligation → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('wh-wins'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    await prisma.$transaction(async (db) => {
      const result = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-webhook-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { event: 'charge.success' },
        now: new Date(),
      });
      expect(result.applied).toBe(true);
    });

    const endAfterWebhook = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    verifyPz.mockResolvedValue({
      verified: true,
      conclusive: true,
      status: 'success',
      reference,
      amount: 5000,
      currency: 'NGN',
      customerEmail: user.email,
      raw: {},
    });

    const { json } = await runCron();
    expect(json.reconciled).toBe(0);
    expect(json.renewed).toBe(0);

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterWebhook);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0].obligationId).toBe(obligIdFor(sub.id, periodEpoch));
  });

  it('cron wins; webhook processes same obligation → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('cron-wins'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    chargePz.mockResolvedValue({ success: true, raw: { data: { id: 'txn-cron-1' } } });
    const { json } = await runCron();
    expect(json.renewed).toBe(1);

    const endAfterCron = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const result = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-cron-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { event: 'charge.success' },
        now: new Date(),
      });
      expect(result.applied).toBe(false);
    });

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterCron);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('webhook and cron execute simultaneously → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('simult'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    chargePz.mockResolvedValue({ success: true, raw: { data: { id: 'txn-simult-1' } } });

    const [cronResult, webhookResult] = await Promise.all([
      runCron(),
      prisma.$transaction(async (db) => {
        return applyEntitlementIfNotApplied(db, {
          userId: sub.userId,
          subscriptionId: sub.id,
          plan: { id: plan.id, durationDays: plan.durationDays },
          provider: 'paystack',
          providerReference: reference,
          obligationId: obligIdFor(sub.id, periodEpoch),
          providerTransactionId: 'txn-simult-1',
          amount: 5000,
          currency: 'NGN' as any,
          fxRateUsed: null,
          renewalToken: null,
          rawPayload: { event: 'charge.success' },
          now: new Date(),
        });
      }),
    ]);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);

    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAfter!.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
  });

  it('same webhook delivered repeatedly → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('replay'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const reference = `pp_${uniqueEmail('ref').split('@')[0]}`;
    const periodEpoch = sub.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const r1 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-replay-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { delivery: 1 },
        now: new Date(),
      });
      expect(r1.applied).toBe(true);
    });

    const endAfterFirst = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const r2 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-replay-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { delivery: 2 },
        now: new Date(),
      });
      expect(r2.applied).toBe(false);
    });

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterFirst);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('same cron obligation retried repeatedly → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('retry-cron'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    chargePz.mockResolvedValue({ success: true, raw: { data: { id: 'txn-retry-1' } } });

    const first = await runCron();
    expect(first.json.renewed).toBe(1);

    const endAfterFirst = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    const second = await runCron();
    expect(second.json.renewed).toBe(0);

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterFirst);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('same obligation with two different provider transaction IDs → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('two-txn'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const reference = `pp_${uniqueEmail('ref').split('@')[0]}`;
    const periodEpoch = sub.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const r1 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-a',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r1.applied).toBe(true);
    });

    const endAfterFirst = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const r2 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-b',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r2.applied).toBe(false);
    });

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterFirst);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('same provider transaction submitted repeatedly → one provider transaction record', async () => {
    const user = await createUser(uniqueEmail('same-txn'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const reference = `pp_${uniqueEmail('ref').split('@')[0]}`;
    const periodEpoch = sub.endAt.getTime();

    await prisma.$transaction(async (db) => {
      const r1 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-same-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r1.applied).toBe(true);
    });

    await prisma.$transaction(async (db) => {
      const r2 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: `${reference}-dup`,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-same-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r2.applied).toBe(false);
    });

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('two separate legitimate obligations → two entitlement applications', async () => {
    const user = await createUser(uniqueEmail('two-oblig'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch1 = sub.endAt.getTime();

    // First obligation (period 1)
    await prisma.$transaction(async (db) => {
      const r1 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: 'pp_oblig-a',
        obligationId: obligIdFor(sub.id, periodEpoch1),
        providerTransactionId: 'txn-oblig-a',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r1.applied).toBe(true);
    });

    const endAfterFirst = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    // Advance subscription to next period (simulate time passing)
    const periodEpoch2 = endAfterFirst;
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { endAt: new Date(periodEpoch2) },
    });

    // Second obligation (period 2) - different canonical obligationId
    await prisma.$transaction(async (db) => {
      const r2 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: 'pp_oblig-b',
        obligationId: obligIdFor(sub.id, periodEpoch2),
        providerTransactionId: 'txn-oblig-b',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
      expect(r2.applied).toBe(true);
    });

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterFirst + 30 * DAY);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(2);
  });

  it('Paystack webhook overlaps cron → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('pz-overlap'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    chargePz.mockResolvedValue({ success: true, raw: { data: { id: 'txn-pz-overlap' } } });

    const [cronJson, webhookRes] = await Promise.all([
      runCron(),
      prisma.$transaction(async (db) => {
        return applyEntitlementIfNotApplied(db, {
          userId: sub.userId,
          subscriptionId: sub.id,
          plan: { id: plan.id, durationDays: plan.durationDays },
          provider: 'paystack',
          providerReference: reference,
          obligationId: obligIdFor(sub.id, periodEpoch),
          providerTransactionId: 'txn-pz-overlap',
          amount: 5000,
          currency: 'NGN' as any,
          fxRateUsed: null,
          renewalToken: null,
          rawPayload: { event: 'charge.success' },
          now: new Date(),
        });
      }),
    ]);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);

    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAfter!.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
  });

  it('Flutterwave webhook overlaps cron → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('flw-overlap'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    chargeFlw.mockResolvedValue({ success: true, raw: { data: { id: 'txn-flw-overlap' } } });

    const [cronJson, webhookRes] = await Promise.all([
      runCron(),
      prisma.$transaction(async (db) => {
        return applyEntitlementIfNotApplied(db, {
          userId: sub.userId,
          subscriptionId: sub.id,
          plan: { id: plan.id, durationDays: plan.durationDays },
          provider: 'flutterwave',
          providerReference: reference,
          obligationId: obligIdFor(sub.id, periodEpoch),
          providerTransactionId: 'txn-flw-overlap',
          amount: 5000,
          currency: 'NGN' as any,
          fxRateUsed: null,
          renewalToken: null,
          rawPayload: { event: 'charge.completed' },
          now: new Date(),
        });
      }),
    ]);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);

    const subAfter = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(subAfter!.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
  });

  it('reconciliation confirms unknown payment → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('reconcile'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id, {
      renewalStatus: 'reconciliation_required',
      renewalLockedAt: new Date(),
    });

    const reference = refFor(sub.id, sub.endAt.getTime());
    await prisma.subscription.update({
      where: { id: sub.id },
      data: { renewalReference: reference },
    });

    verifyPz.mockResolvedValue({
      verified: true,
      conclusive: true,
      status: 'success',
      reference,
      amount: 5000,
      currency: 'NGN',
      customerEmail: user.email,
      raw: {},
    });

    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(chargePz).not.toHaveBeenCalled();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('idle');
    expect(after!.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('reconciliation repeats already-applied payment → no second extension', async () => {
    const user = await createUser(uniqueEmail('reconcile-again'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    await prisma.$transaction(async (db) => {
      await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: reference,
        obligationId: obligIdFor(sub.id, periodEpoch),
        providerTransactionId: 'txn-reconcile-1',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: {},
        now: new Date(),
      });
    });

    const endAfterFirst = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    verifyPz.mockResolvedValue({
      verified: true,
      conclusive: true,
      status: 'success',
      reference,
      amount: 5000,
      currency: 'NGN',
      customerEmail: user.email,
      raw: {},
    });

    const { json } = await runCron();
    expect(json.reconciled).toBe(0);

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterFirst);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('transaction fails before commit → no partial entitlement', async () => {
    const user = await createUser(uniqueEmail('fail-txn'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const reference = refFor(sub.id, periodEpoch);

    await expect(
      prisma.$transaction(async (db) => {
        await db.$executeRawUnsafe('SELECT pg_advisory_xact_lock(12345)');
        throw new Error('simulated commit failure');
      }),
    ).rejects.toThrow('simulated commit failure');

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(sub.endAt.getTime());

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(0);
  });

  it('same obligation, webhook pp_<uuid> vs cron renew_<sub>_<period>_att1 → one entitlement application', async () => {
    const user = await createUser(uniqueEmail('cross-path'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const periodEpoch = sub.endAt.getTime();
    const obligationId = obligIdFor(sub.id, periodEpoch);
    const webhookRef = `pp_${uniqueEmail('ref').split('@')[0]}`;
    const cronRef = refFor(sub.id, periodEpoch); // renew_<sub.id>_<periodEpoch>_att1

    // Webhook path: provider reference is pp_<uuid>, obligationId is canonical
    await prisma.$transaction(async (db) => {
      const r1 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: webhookRef,
        obligationId,
        providerTransactionId: 'txn-webhook-cross',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { event: 'charge.success' },
        now: new Date(),
      });
      expect(r1.applied).toBe(true);
    });

    const endAfterWebhook = (
      await prisma.subscription.findUnique({ where: { id: sub.id } })
    )!.endAt.getTime();

    // Cron path: different provider reference, same obligationId → idempotent
    await prisma.$transaction(async (db) => {
      const r2 = await applyEntitlementIfNotApplied(db, {
        userId: sub.userId,
        subscriptionId: sub.id,
        plan: { id: plan.id, durationDays: plan.durationDays },
        provider: 'paystack',
        providerReference: cronRef,
        obligationId,
        providerTransactionId: 'txn-cron-cross',
        amount: 5000,
        currency: 'NGN' as any,
        fxRateUsed: null,
        renewalToken: null,
        rawPayload: { event: 'charge.success' },
        now: new Date(),
      });
      expect(r2.applied).toBe(false); // already applied via webhook
    });

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.endAt.getTime()).toBe(endAfterWebhook); // not extended again

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1); // one entitlement ledger record
    expect(txs[0].obligationId).toBe(obligationId);
    expect(txs[0].providerReference).toBe(webhookRef); // original reference preserved
  });
});
