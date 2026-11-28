import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// =============================================================================
// F-02 REAL PostgreSQL INTEGRATION TESTS
// =============================================================================
// Providers are MOCKED (no live Paystack/Flutterwave calls). The DATABASE is
// REAL PostgreSQL (Neon test database via TEST_DATABASE_URL, bound by
// tests/renewal-integration-setup.ts which runs before these imports). These
// tests exercise DB-level atomicity: exclusive claims, row-level locking,
// conditional endAt guards, and reconciliation state transitions against a live
// Postgres. They are clearly separated from the mocked unit tests.

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
vi.mock('@/lib/email', () => ({
  sendRenewalReminderEmail: vi.fn().mockResolvedValue(true),
  getAppUrl: vi.fn(() => 'http://localhost:3000'),
}));

import { prisma } from '@/lib/prisma';
import { paystackChargeAuthorization, paystackVerifyTransaction } from '@/lib/providers/paystack';

const chargePz = paystackChargeAuthorization as unknown as ReturnType<typeof vi.fn>;
const verifyPz = paystackVerifyTransaction as unknown as ReturnType<typeof vi.fn>;

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

// Stable reference format used by stableRenewalReference(sub, periodEpoch):
// renew_${sub.id}_${periodEpoch}_att1 (when no stored reference matches).
function refFor(subId: string, periodEpoch: number): string {
  return `renew_${subId}_${periodEpoch}_att1`;
}

async function createSubscription(userId: string, planId: string, overrides: any = {}) {
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
  for (const id of createdSubs) {
    await prisma.subscription.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdUsers) {
    await prisma.user.delete({ where: { id } }).catch(() => {});
  }
  for (const id of createdPlans) {
    await prisma.plan.delete({ where: { id } }).catch(() => {});
  }
  createdSubs = [];
  createdUsers = [];
  createdPlans = [];
}

beforeEach(async () => {
  chargePz.mockReset().mockResolvedValue({ success: true, raw: { data: { id: 'txn_1' } } });
  verifyPz.mockReset().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
  await cleanup();
});

afterEach(async () => {
  await cleanup();
});

describe('F-02 real-DB: exclusive reconciliation claim (no duplicate charges)', () => {
  it('two concurrent cron executions charge the same subscription exactly once', async () => {
    const user = await createUser(uniqueEmail('conc'));
    const plan = await createPlan();
    const sub = await createSubscription(user.id, plan.id);

    const [a, b] = await Promise.all([runCron(), runCron()]);

    const total = (a.json.renewed ?? 0) + (b.json.renewed ?? 0) + (a.json.reconciled ?? 0) + (b.json.reconciled ?? 0);
    expect(total).toBe(1);
    expect(chargePz).toHaveBeenCalledTimes(1);

    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
    expect(txs[0].providerReference).toBe(refFor(sub.id, sub.endAt.getTime()));

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('idle');
    expect(after!.renewalAttempts).toBe(0);
  });
});

describe('F-02 real-DB: worker crash recovery (stale processing reclaim)', () => {
  it('reclaims a stale processing subscription and reconciles without double-charging', async () => {
    const user = await createUser(uniqueEmail('crash'));
    const plan = await createPlan();
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    const sub = await createSubscription(user.id, plan.id, {
      endAt,
      renewalStatus: 'processing',
      renewalLockedAt: new Date(Date.now() - 30 * 60 * 1000),
    });
    const ref = refFor(sub.id, endAt.getTime());
    await prisma.subscription.update({ where: { id: sub.id }, data: { renewalReference: ref } });
    // Simulate a crashed worker: the lease (updatedAt) is stale (>15 min) and no
    // further writes happen after this point.
    const stale = new Date(Date.now() - 30 * 60 * 1000);
    await prisma.$executeRawUnsafe(
      'UPDATE "Subscription" SET "updatedAt" = $1, "renewalLockedAt" = $2 WHERE "id" = $3',
      stale,
      stale,
      sub.id,
    );

    verifyPz.mockResolvedValue({
      verified: true,
      conclusive: true,
      status: 'success',
      reference: ref,
      amount: 5000,
      currency: 'NGN',
      customerEmail: user.email,
      raw: {},
    });

    const { json } = await runCron();
    // The stale row is reclaimed and reconciled (verify before any charge).
    expect(json.reconciled + json.renewed).toBe(1);
    expect(chargePz).not.toHaveBeenCalled();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('idle');
    expect(after!.renewalReference).toBeNull(); // cleared once renewal completes
    expect(after!.renewalAttempts).toBe(0);
    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(1);
  });

  it('blocks claiming an actively locked subscription within the lease window', async () => {
    const user = await createUser(uniqueEmail('lock'));
    const plan = await createPlan();
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    await createSubscription(user.id, plan.id, {
      endAt,
      renewalStatus: 'processing',
      renewalLockedAt: new Date(Date.now() - 2 * 60 * 1000), // inside 15-min lease
      renewalReference: refFor('ignored', endAt.getTime()),
    });

    const { json } = await runCron();
    expect(json.renewed).toBe(0);
    expect(chargePz).not.toHaveBeenCalled();
    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(0);
  });
});

describe('F-02 real-DB: endAt snapshot protection (no stale overwrite)', () => {
  it('cron advances endAt from the CURRENT value, not a stale snapshot (no shortening)', async () => {
    const user = await createUser(uniqueEmail('endat'));
    const plan = await createPlan();
    const originalEnd = new Date(Date.now() + 30 * 60 * 1000); // 30min from now (within 24h cutoff)
    // Simulate a webhook that already advanced endAt by 2 hours (still within cutoff).
    const webhookEnd = new Date(originalEnd.getTime() + 2 * 60 * 60 * 1000);
    const sub = await createSubscription(user.id, plan.id, {
      endAt: originalEnd,
      renewalStatus: 'idle',
      renewalLockedAt: null,
      renewalReference: null,
    });
    await prisma.subscription.update({ where: { id: sub.id }, data: { endAt: webhookEnd } });

    chargePz.mockResolvedValue({ success: true, raw: { id: 1 } });
    await runCron();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    // 30-day duration applied to the webhook-advanced endAt (current), not the stale original.
    expect(after!.endAt.getTime()).toBe(webhookEnd.getTime() + 30 * DAY);
  });
});

describe('F-02 real-DB: provider timeout and unknown outcomes', () => {
  it('timeout (AbortError) -> unknown, no charge, no attempt increment, reference kept', async () => {
    const user = await createUser(uniqueEmail('timeout'));
    const plan = await createPlan();
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    const sub = await createSubscription(user.id, plan.id, {
      endAt,
      renewalStatus: 'reconciliation_required',
      renewalLockedAt: new Date(),
    });
    const ref = refFor(sub.id, endAt.getTime());
    await prisma.subscription.update({ where: { id: sub.id }, data: { renewalReference: ref } });

    verifyPz.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    await runCron();
    expect(chargePz).not.toHaveBeenCalled();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('reconciliation_required');
    expect(after!.renewalAttempts).toBe(0);
    expect(after!.renewalReference).toBe(ref);
    expect(after!.status).toBe('active');
    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(0);
  });

  it('provider 5xx (unknown) -> reconciliation_required, no charge, no attempt increment', async () => {
    const user = await createUser(uniqueEmail('5xx'));
    const plan = await createPlan();
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    const sub = await createSubscription(user.id, plan.id, {
      endAt,
      renewalStatus: 'reconciliation_required',
      renewalLockedAt: new Date(),
    });
    const ref = refFor(sub.id, endAt.getTime());
    await prisma.subscription.update({ where: { id: sub.id }, data: { renewalReference: ref } });

    verifyPz.mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} });

    await runCron();
    expect(chargePz).not.toHaveBeenCalled();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('reconciliation_required');
    expect(after!.renewalAttempts).toBe(0);
    expect(after!.renewalReference).toBe(ref);
  });

  it('incomplete provider verification record is NOT treated as verified -> reconciliation, no entitlement', async () => {
    const user = await createUser(uniqueEmail('incomplete'));
    const plan = await createPlan();
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    const sub = await createSubscription(user.id, plan.id, {
      endAt,
      renewalStatus: 'reconciliation_required',
      renewalLockedAt: new Date(),
    });
    const ref = refFor(sub.id, endAt.getTime());
    await prisma.subscription.update({ where: { id: sub.id }, data: { renewalReference: ref } });

    // Incomplete 2xx record: conclusive false, verified false (F-02.4 fix).
    verifyPz.mockResolvedValue({
      verified: false,
      conclusive: false,
      reference: ref,
      amount: 0,
      currency: '',
      status: '',
      raw: {},
    });

    await runCron();
    expect(chargePz).not.toHaveBeenCalled();

    const after = await prisma.subscription.findUnique({ where: { id: sub.id } });
    expect(after!.renewalStatus).toBe('reconciliation_required');
    expect(after!.renewalAttempts).toBe(0);
    expect(after!.renewalReference).toBe(ref);
    expect(after!.status).toBe('active');
    const txs = await prisma.transaction.findMany({ where: { userId: user.id } });
    expect(txs).toHaveLength(0); // no entitlement granted
  });
});
