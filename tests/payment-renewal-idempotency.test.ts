import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---- Fake Prisma with atomic updateMany + failure injection -----------------
function makeFakeDb() {
  const subscriptions = new Map<string, any>();
  const transactions = new Map<string, any>();
  let failNextTransaction = false;

  const matchesOr = (sub: any, or: any[]) =>
    or.some((cond: any) => {
      if (cond.renewalStatus && sub.renewalStatus !== cond.renewalStatus) return false;
      if (cond.renewalLockedAt?.lt && !(sub.renewalLockedAt && sub.renewalLockedAt < cond.renewalLockedAt.lt)) return false;
      return true;
    });

  const db: any = {
    subscription: {
      findMany: vi.fn(async ({ where }: any) =>
        [...subscriptions.values()].filter((sub) => {
          if (where.status && sub.status !== where.status) return false;
          if (where.autoRenew !== undefined && sub.autoRenew !== where.autoRenew) return false;
          if (where.endAt?.lte && !(sub.endAt <= where.endAt.lte)) return false;
          if (where.OR && !matchesOr(sub, where.OR)) return false;
          return true;
        })
      ),
      findUnique: vi.fn(async ({ where }: any) => subscriptions.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const sub = subscriptions.get(where.id);
        if (!sub) return { count: 0 };
        if (where.status && sub.status !== where.status) return { count: 0 };
        if (where.autoRenew !== undefined && sub.autoRenew !== where.autoRenew) return { count: 0 };
        if (where.OR && !matchesOr(sub, where.OR)) return { count: 0 };
        subscriptions.set(where.id, { ...sub, ...data, updatedAt: new Date() });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sub = subscriptions.get(where.id);
        const updated = { ...sub, ...data, updatedAt: new Date() };
        subscriptions.set(where.id, updated);
        return updated;
      }),
    },
    transaction: {
      findUnique: vi.fn(async ({ where }: any) =>
        [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null
      ),
      create: vi.fn(async ({ data }: any) => {
        if (transactions.has(data.providerReference)) {
          const e: any = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        const record = { id: `tx-${transactions.size + 1}`, ...data };
        transactions.set(data.providerReference, record);
        return record;
      }),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (failNextTransaction) {
        failNextTransaction = false;
        throw new Error('DB commit failed');
      }
      return fn(db);
    }),
    _seed(sub: any) {
      subscriptions.set(sub.id, sub);
    },
    _getSub: (id: string) => subscriptions.get(id),
    _getTransactions: () => [...transactions.values()],
    _failNextTransaction: () => {
      failNextTransaction = true;
    },
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;
vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

vi.mock('@/lib/providers/paystack', () => ({
  paystackChargeAuthorization: vi.fn(),
  paystackVerifyTransaction: vi.fn(),
}));
vi.mock('@/lib/providers/flutterwave', () => ({
  flutterwaveChargeToken: vi.fn(),
  flutterwaveVerifyTransaction: vi.fn(),
}));
vi.mock('@/lib/email', () => ({
  sendRenewalReminderEmail: vi.fn().mockResolvedValue(true),
  getAppUrl: vi.fn(() => 'http://localhost:3000'),
}));

import { paystackChargeAuthorization, paystackVerifyTransaction } from '@/lib/providers/paystack';
import { flutterwaveChargeToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';

const chargePz = paystackChargeAuthorization as unknown as ReturnType<typeof vi.fn>;
const verifyPz = paystackVerifyTransaction as unknown as ReturnType<typeof vi.fn>;
const chargeFlw = flutterwaveChargeToken as unknown as ReturnType<typeof vi.fn>;
const verifyFlw = flutterwaveVerifyTransaction as unknown as ReturnType<typeof vi.fn>;

function seedSub(overrides: any = {}) {
  const endAt = new Date(Date.now() + 60 * 60 * 1000); // 1h from now (within 24h cutoff)
  const sub = {
    id: 'sub-1',
    userId: 'user-1',
    planId: 'plan-1',
    status: 'active',
    autoRenew: true,
    endAt,
    renewalProvider: 'paystack',
    renewalAuthCode: 'AUTH_test_123',
    renewalAttempts: 0,
    renewalStatus: 'idle',
    renewalLockedAt: null,
    renewalReference: null,
    updatedAt: new Date(),
    plan: { id: 'plan-1', name: 'VIP', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
    user: { id: 'user-1', email: 'test@example.com', country: 'NG' },
    ...overrides,
  };
  fakeDb._seed(sub);
  return sub;
}

async function runCron() {
  const { GET } = await import('@/app/api/cron/renew/route');
  const req = new Request('http://localhost/api/cron/renew', {
    headers: { authorization: 'Bearer test_cron_secret' },
  });
  const res = await GET(req as any);
  return { res, json: await res.json() };
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  process.env.CRON_SECRET = 'test_cron_secret';
  process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900';
  chargePz.mockReset().mockResolvedValue({ success: true, raw: { id: 1 } });
  verifyPz.mockReset().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
  chargeFlw.mockReset().mockResolvedValue({ success: true, raw: { id: 2 } });
  verifyFlw.mockReset().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
});

describe('F-02 renewal idempotency (Paystack)', () => {
  it('1. charge success + commit success renews exactly once', async () => {
    seedSub();
    const { json } = await runCron();
    expect(json.renewed).toBe(1);
    expect(chargePz).toHaveBeenCalledTimes(1);
    expect(fakeDb._getTransactions()).toHaveLength(1);
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('idle');
    expect(sub.renewalAttempts).toBe(0);
    expect(sub.renewalReference).toBeNull();
  });

  it('2/3/4/5. commit failure after charge → reconciliation_required, retry reconciles, no second charge', async () => {
    seedSub();
    fakeDb._failNextTransaction();

    const first = await runCron();
    expect(first.json.renewed).toBe(0);
    // No transaction persisted, no subscription activation.
    expect(fakeDb._getTransactions()).toHaveLength(0);
    const afterFail = fakeDb._getSub('sub-1');
    expect(afterFail.renewalStatus).toBe('reconciliation_required');
    expect(afterFail.renewalReference).toMatch(/^renew_sub-1_\d+_att1$/);
    const stableRef = afterFail.renewalReference;
    expect(chargePz).toHaveBeenCalledTimes(1); // charged once

    // Retry: must reconcile (verify) BEFORE any new charge.
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: { id: 1 } }));
    const second = await runCron();
    expect(second.json.reconciled).toBe(1);
    expect(verifyPz).toHaveBeenCalledWith({ reference: stableRef });
    expect(chargePz).toHaveBeenCalledTimes(1); // still one charge — no double charge
    expect(fakeDb._getTransactions()).toHaveLength(1);
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('idle');
    expect(sub.endAt.getTime()).toBeGreaterThan(afterFail.endAt.getTime());
  });

  it('6. provider pending → stays reconciliation_required, no new charge', async () => {
    seedSub({ renewalStatus: 'reconciliation_required', renewalReference: 'renew_sub-1_x_att1', renewalAttempts: 1 });
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('7/8. provider verification unavailable (throws) → reconciliation_required, no charge', async () => {
    seedSub({ renewalStatus: 'reconciliation_required', renewalReference: 'renew_sub-1_x_att1', renewalAttempts: 1 });
    verifyPz.mockRejectedValue(new Error('provider unreachable'));
    await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('9. definitive provider failure → marked failed, no transaction, attempt advances', async () => {
    seedSub();
    chargePz.mockResolvedValue({ success: false, raw: {} });
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'failed', raw: {} });
    const { json } = await runCron();
    expect(json.renewed).toBe(0);
    expect(fakeDb._getTransactions()).toHaveLength(0);
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('failed');
    expect(sub.renewalAttempts).toBe(1);
  });

  it('10. two concurrent workers charge only once', async () => {
    seedSub();
    const [{ json: j1 }, { json: j2 }] = await Promise.all([runCron(), runCron()]);
    expect(j1.renewed + j2.renewed).toBe(1);
    expect(chargePz).toHaveBeenCalledTimes(1);
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });

  it('11/12. repeated cron runs do not re-apply the renewal', async () => {
    seedSub();
    const first = await runCron();
    expect(first.json.renewed).toBe(1);
    const endAfterFirst = fakeDb._getSub('sub-1').endAt.getTime();
    const second = await runCron();
    expect(second.json.renewed).toBe(0); // endAt now beyond cutoff → not due
    expect(fakeDb._getSub('sub-1').endAt.getTime()).toBe(endAfterFirst);
    expect(chargePz).toHaveBeenCalledTimes(1);
  });

  it('13. failed DB write does not falsely activate the subscription', async () => {
    const sub = seedSub();
    const originalEnd = sub.endAt.getTime();
    fakeDb._failNextTransaction();
    await runCron();
    const after = fakeDb._getSub('sub-1');
    expect(after.endAt.getTime()).toBe(originalEnd); // not extended
    expect(after.renewalStatus).toBe('reconciliation_required');
    expect(fakeDb._getTransactions()).toHaveLength(0);
  });
});

describe('F-02 renewal idempotency (Flutterwave, independent path)', () => {
  it('charge success + commit failure → reconcile via Flutterwave verify, no second charge', async () => {
    seedSub({ renewalProvider: 'flutterwave' });
    fakeDb._failNextTransaction();
    await runCron();
    expect(chargeFlw).toHaveBeenCalledTimes(1);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
    const stableRef = fakeDb._getSub('sub-1').renewalReference;

    verifyFlw.mockImplementation(async ({ txRef }: any) => ({ verified: true, conclusive: true, status: 'successful', txRef, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const second = await runCron();
    expect(second.json.reconciled).toBe(1);
    expect(verifyFlw).toHaveBeenCalledWith({ txRef: stableRef });
    expect(chargeFlw).toHaveBeenCalledTimes(1);
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });

  it('definitive Flutterwave failure → failed, no transaction', async () => {
    seedSub({ renewalProvider: 'flutterwave' });
    chargeFlw.mockResolvedValue({ success: false, raw: {} });
    verifyFlw.mockResolvedValue({ verified: true, conclusive: true, status: 'failed', raw: {} });
    const { json } = await runCron();
    expect(json.renewed).toBe(0);
    expect(fakeDb._getTransactions()).toHaveLength(0);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('failed');
  });
});

describe('F-02 hardening (Phase 1D.6)', () => {
  function seedStaleProcessing(overrides: any = {}) {
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    const epoch = endAt.getTime();
    return seedSub({
      endAt,
      renewalStatus: 'processing',
      renewalLockedAt: new Date(Date.now() - 30 * 60 * 1000), // stale (>15m lease)
      renewalReference: `renew_sub-1_${epoch}_att1`,
      renewalAttempts: 0,
      ...overrides,
    });
  }

  it('1/10. stale processing with UNKNOWN prior outcome reconciles before charging (no charge)', async () => {
    seedStaleProcessing();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    const { json } = await runCron();
    expect(verifyPz).toHaveBeenCalledTimes(1);
    expect(chargePz).not.toHaveBeenCalled();
    expect(json.renewed).toBe(0);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('2. stale processing with confirmed provider SUCCESS recovers without charging', async () => {
    seedStaleProcessing();
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    expect(json.reconciled).toBe(1);
    expect(fakeDb._getTransactions()).toHaveLength(1);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('idle');
  });

  it('3. stale processing with confirmed FAILURE (no charge occurred) proceeds to charge', async () => {
    seedStaleProcessing();
    verifyPz.mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} });
    const { json } = await runCron();
    expect(verifyPz).toHaveBeenCalledTimes(1);
    expect(chargePz).toHaveBeenCalledTimes(1);
    expect(json.renewed).toBe(1);
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });

  it('4. unavailable verification (throws) does NOT trigger another charge', async () => {
    seedStaleProcessing();
    verifyPz.mockRejectedValue(new Error('timeout'));
    const { json } = await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    expect(json.renewed).toBe(0);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('5. uncertain outcome (commit failure) does NOT increment renewalAttempts', async () => {
    seedSub();
    fakeDb._failNextTransaction();
    await runCron();
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalAttempts).toBe(0);
    expect(sub.renewalStatus).toBe('reconciliation_required');
    expect(sub.renewalReference).toMatch(/^renew_sub-1_\d+_att1$/);
  });

  it('6/8. repeated DB failures do NOT consume the definitive budget and never auto-expire', async () => {
    seedSub();
    for (let i = 0; i < 5; i++) {
      verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
      fakeDb._failNextTransaction();
      await runCron();
      const sub = fakeDb._getSub('sub-1');
      expect(sub.renewalAttempts).toBe(0);
      expect(sub.status).toBe('active');
      expect(sub.renewalStatus).toBe('reconciliation_required');
    }
    expect(fakeDb._getTransactions()).toHaveLength(0);
  });

  it('7/9. reconciliation still succeeds after the ordinary retry limit; restores entitlement once', async () => {
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    seedSub({ endAt, renewalStatus: 'reconciliation_required', renewalAttempts: 9, renewalReference: `renew_sub-1_${endAt.getTime()}_att1`, renewalLockedAt: new Date() });
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(chargePz).not.toHaveBeenCalled();
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('idle');
    expect(sub.endAt.getTime()).toBeGreaterThan(endAt.getTime());
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });

  it('11. Flutterwave stale processing with unknown outcome also reconciles (no charge)', async () => {
    seedStaleProcessing({ renewalProvider: 'flutterwave' });
    verifyFlw.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    const { json } = await runCron();
    expect(chargeFlw).not.toHaveBeenCalled();
    expect(json.renewed).toBe(0);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('12. post-window attempt is throttled (no immediate verify), record kept, never auto-expire', async () => {
    const endAt = new Date(Date.now() + 60 * 60 * 1000);
    seedSub({
      endAt,
      renewalStatus: 'reconciliation_required',
      renewalAttempts: 0,
      renewalReference: `renew_sub-1_${endAt.getTime()}_att1`,
      renewalLockedAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000), // 8 days > 7-day window
    });
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    expect(verifyPz).not.toHaveBeenCalled();
    expect(json.reconciled).toBe(0);
    const sub = fakeDb._getSub('sub-1');
    expect(sub.status).toBe('active');
    expect(sub.renewalStatus).toBe('reconciliation_required');
    expect(sub.renewalAttempts).toBe(0);
  });
});