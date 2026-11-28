import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cron-level policy tests. Provider modules are MOCKED (no live calls); the
// `conclusive` flag mirrors what the real providers return (see
// provider-verification-classification.test.ts). The fake Prisma mimics
// @updatedAt so the post-window throttle is deterministic.

function makeFakeDb() {
  const subscriptions = new Map<string, any>();
  const transactions = new Map<string, any>();
  let failNextTransaction = false;

  const now = () => new Date();

  const matchesOr = (sub: any, or: any[]) =>
    or.some((cond: any) => {
      if (cond.renewalStatus && sub.renewalStatus !== cond.renewalStatus) return false;
      if (cond.renewalLockedAt?.lt && !(sub.renewalLockedAt && sub.renewalLockedAt < cond.renewalLockedAt.lt)) return false;
      if (cond.updatedAt?.lt && !(sub.updatedAt && sub.updatedAt < cond.updatedAt.lt)) return false;
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
        subscriptions.set(where.id, { ...sub, ...data, updatedAt: now() });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sub = subscriptions.get(where.id);
        const updated = { ...sub, ...data, updatedAt: now() };
        subscriptions.set(where.id, updated);
        return updated;
      }),
    },
    transaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        // Support composite unique lookup: { provider_providerTransactionId: { provider, providerTransactionId } }
        if (where.provider_providerTransactionId) {
          const { provider, providerTransactionId } = where.provider_providerTransactionId;
          return [...transactions.values()].find(
            (t) => t.provider === provider && t.providerTransactionId === providerTransactionId
          ) ?? null;
        }
        // Support obligationId lookup
        if (where.obligationId) {
          return [...transactions.values()].find((t) => t.obligationId === where.obligationId) ?? null;
        }
        if (where.providerReference) {
          return [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null;
        }
        return transactions.get(where.id) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        // Check unique constraints
        if (data.providerReference && [...transactions.values()].some((t) => t.providerReference === data.providerReference)) {
          const e: any = new Error('Unique constraint failed');
          e.code = 'P2002';
          throw e;
        }
        if (data.obligationId && [...transactions.values()].some((t) => t.obligationId === data.obligationId)) {
          const e: any = new Error('Unique constraint failed on obligationId');
          e.code = 'P2002';
          throw e;
        }
        if (data.providerTransactionId && [...transactions.values()].some((t) => t.provider === data.provider && t.providerTransactionId === data.providerTransactionId)) {
          const e: any = new Error('Unique constraint failed on provider_providerTransactionId');
          e.code = 'P2002';
          throw e;
        }
        const id = `tx-${transactions.size + 1}`;
        const record = { id, ...data, createdAt: now(), updatedAt: now() };
        transactions.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = [...transactions.values()].find((t) => t.id === where.id);
        if (!existing) return null;
        const updated = { ...existing, ...data, updatedAt: now() };
        transactions.set(updated.id, updated);
        return updated;
      }),
    },
    $executeRawUnsafe: vi.fn(async (sql: string, ...params: any[]) => {
      // Simulate: UPDATE "Subscription" SET "endAt" = GREATEST("endAt", $1) + ($2 * interval '1 day'), ...
      if (sql.includes('UPDATE "Subscription"')) {
        const [nowVal, durationDays, subId] = params;
        const sub = subscriptions.get(subId);
        if (sub && sub.status === 'active') {
          const currentEnd = sub.endAt ? new Date(sub.endAt).getTime() : 0;
          const nowTime = new Date(nowVal).getTime();
          const baseEnd = Math.max(currentEnd, nowTime);
          const newEnd = new Date(baseEnd + Number(durationDays) * 24 * 60 * 60 * 1000);
          subscriptions.set(subId, {
            ...sub,
            endAt: newEnd,
            updatedAt: new Date(nowVal),
            renewalStatus: 'idle',
            renewalLockedAt: null,
            renewalReference: null,
            renewalAttempts: 0,
            lastRenewalError: null,
          });
          return { count: 1 };
        }
        return { count: 0 };
      }
      return { count: 0 };
    }),
    $transaction: vi.fn(async (fn: any) => {
      if (failNextTransaction) {
        failNextTransaction = false;
        throw new Error('DB commit failed');
      }
      return fn(db);
    }),
    _seed(sub: any) {
      subscriptions.set(sub.id, { ...sub, updatedAt: sub.updatedAt ?? now() });
    },
    _getSub: (id: string) => subscriptions.get(id),
    _getTransactions: () => [...transactions.values()],
    _failNextTransaction: () => {
      failNextTransaction = true;
    },
    _setUpdatedAt(id: string, d: Date) {
      const sub = subscriptions.get(id);
      if (sub) sub.updatedAt = d;
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

import { paystackChargeAuthorization, paystackVerifyTransaction } from '@/lib/providers/paystack';
import { flutterwaveChargeToken, flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';

const chargePz = paystackChargeAuthorization as unknown as ReturnType<typeof vi.fn>;
const verifyPz = paystackVerifyTransaction as unknown as ReturnType<typeof vi.fn>;
const chargeFlw = flutterwaveChargeToken as unknown as ReturnType<typeof vi.fn>;
const verifyFlw = flutterwaveVerifyTransaction as unknown as ReturnType<typeof vi.fn>;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const RECOVERY_INTERVAL = 6 * HOUR; // default RENEWAL_RECOVERY_INTERVAL_SECONDS

function seedBase(overrides: any = {}) {
  const endAt = new Date(Date.now() + 1 * HOUR);
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
    renewalStatus: 'reconciliation_required',
    renewalLockedAt: new Date(),
    renewalReference: `renew_sub-1_${endAt.getTime()}_att1`,
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
  delete process.env.RENEWAL_RECOVERY_INTERVAL_SECONDS;
  chargePz.mockReset().mockResolvedValue({ success: true, raw: { data: { id: 'txn_1' } } });
  verifyPz.mockReset().mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} });
  chargeFlw.mockReset().mockResolvedValue({ success: true, raw: { data: { id: 'txn_2' } } });
  verifyFlw.mockReset().mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} });
});

// Unknown-outcome variants. Each represents an INCONCLUSIVE verification.
const unknownCases: { name: string; apply: (v: ReturnType<typeof vi.fn>) => void }[] = [
  { name: 'HTTP 5xx (conclusive:false)', apply: (v) => v.mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} }) },
  { name: 'network exception', apply: (v) => v.mockRejectedValue(new Error('ECONNRESET')) },
  { name: 'timeout', apply: (v) => v.mockRejectedValue(new DOMException('Aborted', 'AbortError')) },
  { name: 'malformed (conclusive:false)', apply: (v) => v.mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} }) },
  { name: 'missing status (conclusive, no status)', apply: (v) => v.mockResolvedValue({ verified: true, conclusive: true, status: undefined, raw: {} }) },
  { name: 'pending (inconclusive status)', apply: (v) => v.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} }) },
];

function assertUnknownInvariants(sub: any, ref: string) {
  expect(sub.renewalStatus).toBe('reconciliation_required');
  expect(sub.renewalAttempts).toBe(0); // never consumes definitive budget
  expect(sub.renewalReference).toBe(ref); // original reference retained
  expect(sub.status).toBe('active'); // never expired
  expect(fakeDb._getTransactions()).toHaveLength(0); // no entitlement granted
}

describe('F-02 verification classification — Paystack (cron policy)', () => {
  for (const c of unknownCases) {
    it(`unknown: ${c.name} → no charge, no attempt, ref kept, reconciliation_required`, async () => {
      const sub = seedBase();
      c.apply(verifyPz);
      await runCron();
      expect(chargePz).not.toHaveBeenCalled();
      assertUnknownInvariants(fakeDb._getSub('sub-1'), sub.renewalReference);
    });
  }

  it('confirmed success restores entitlement without charging', async () => {
    const sub = seedBase();
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(chargePz).not.toHaveBeenCalled();
    const after = fakeDb._getSub('sub-1');
    expect(after.renewalStatus).toBe('idle');
    expect(after.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
  });

  it('confirmed definitive failure follows failure policy (attempt++, no charge)', async () => {
    seedBase();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'failed', raw: {} });
    await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('failed');
    expect(sub.renewalAttempts).toBe(1);
    expect(sub.status).toBe('active'); // not expired at attempt 1
  });
});

describe('F-02 verification classification — Flutterwave (cron policy)', () => {
  for (const c of unknownCases) {
    it(`unknown: ${c.name} → no charge, no attempt, ref kept, reconciliation_required`, async () => {
      const sub = seedBase({ renewalProvider: 'flutterwave' });
      c.apply(verifyFlw);
      await runCron();
      expect(chargeFlw).not.toHaveBeenCalled();
      assertUnknownInvariants(fakeDb._getSub('sub-1'), sub.renewalReference);
    });
  }

  it('confirmed success restores entitlement without charging', async () => {
    const sub = seedBase({ renewalProvider: 'flutterwave' });
    verifyFlw.mockImplementation(async ({ txRef }: any) => ({ verified: true, conclusive: true, status: 'successful', txRef, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(chargeFlw).not.toHaveBeenCalled();
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('idle');
    expect(fakeDb._getSub('sub-1').endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
  });
});

describe('F-02 long-term recovery after the 7-day window', () => {
  function seedPostWindow(provider: 'paystack' | 'flutterwave' = 'paystack') {
    const endAt = new Date(Date.now() + 1 * HOUR);
    return seedBase({
      renewalProvider: provider,
      endAt,
      renewalLockedAt: new Date(Date.now() - 8 * DAY), // past the 7-day window
      renewalReference: `renew_sub-1_${endAt.getTime()}_att1`,
      updatedAt: new Date(), // last attempt just now
    });
  }

  it('1. unresolved payment remains in reconciliation after seven days', async () => {
    const sub = seedPostWindow();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    // Make it eligible (interval elapsed since last attempt).
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    await runCron();
    const after = fakeDb._getSub('sub-1');
    expect(after.renewalStatus).toBe('reconciliation_required');
    expect(after.renewalReference).toBe(sub.renewalReference);
    expect(after.status).toBe('active');
  });

  it('2. verification is NOT attempted on every cron run after the window (throttled)', async () => {
    seedPostWindow();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    await runCron(); // throttled (last attempt just now)
    await runCron(); // still throttled
    expect(verifyPz).not.toHaveBeenCalled();
    expect(chargePz).not.toHaveBeenCalled();
  });

  it('3. verification becomes eligible again after the recovery interval', async () => {
    seedPostWindow();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    await runCron();
    expect(verifyPz).toHaveBeenCalledTimes(1);
    // Next run immediately is throttled again (not permanent, but rate-limited).
    verifyPz.mockClear();
    await runCron();
    expect(verifyPz).not.toHaveBeenCalled();
  });

  it('4. repeated unknown results preserve reference and never consume attempts', async () => {
    const sub = seedPostWindow();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    for (let i = 0; i < 3; i++) {
      fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
      await runCron();
      const s = fakeDb._getSub('sub-1');
      expect(s.renewalAttempts).toBe(0);
      expect(s.renewalReference).toBe(sub.renewalReference);
      expect(s.renewalStatus).toBe('reconciliation_required');
    }
    expect(chargePz).not.toHaveBeenCalled();
  });

  it('5. successful verification after seven days restores entitlement once', async () => {
    const sub = seedPostWindow();
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(chargePz).not.toHaveBeenCalled();
    const after = fakeDb._getSub('sub-1');
    expect(after.renewalStatus).toBe('idle');
    expect(after.endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });

  it('6. definitive failure after seven days follows the failure policy', async () => {
    seedPostWindow();
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'failed', raw: {} });
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('failed');
    expect(sub.renewalAttempts).toBe(1);
    expect(sub.status).toBe('active');
  });

  it('7. no post-window path bypasses reconciliation to charge again (unknown loops)', async () => {
    seedPostWindow();
    verifyPz.mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} }); // 5xx
    for (let i = 0; i < 4; i++) {
      fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
      await runCron();
    }
    expect(chargePz).not.toHaveBeenCalled();
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('reconciliation_required');
  });

  it('8. Flutterwave behaves consistently post-window (throttle + unknown + success)', async () => {
    const sub = seedPostWindow('flutterwave');
    verifyFlw.mockResolvedValue({ verified: true, conclusive: false, status: 'failed', raw: {} });
    await runCron(); // throttled
    expect(verifyFlw).not.toHaveBeenCalled();
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    await runCron(); // eligible → unknown
    expect(verifyFlw).toHaveBeenCalledTimes(1);
    expect(chargeFlw).not.toHaveBeenCalled();
    expect(fakeDb._getSub('sub-1').renewalReference).toBe(sub.renewalReference);

    verifyFlw.mockImplementation(async ({ txRef }: any) => ({ verified: true, conclusive: true, status: 'successful', txRef, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    fakeDb._setUpdatedAt('sub-1', new Date(Date.now() - RECOVERY_INTERVAL - 60_000));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('idle');
  });
});

describe('F-02 record validation (mismatch → reconciliation, never entitlement)', () => {
  // Each case returns a conclusively-verified record that must be REJECTED by
  // validateRenewalRecord before any entitlement is granted.
  const mismatchCases: { name: string; pz: any; flw: any }[] = [
    { name: 'incorrect amount', pz: { reference: 'REF', amount: 4000, currency: 'NGN', customerEmail: 'test@example.com' }, flw: { txRef: 'REF', amount: 4000, currency: 'NGN', customerEmail: 'test@example.com' } },
    { name: 'incorrect currency', pz: { reference: 'REF', amount: 5000, currency: 'USD', customerEmail: 'test@example.com' }, flw: { txRef: 'REF', amount: 5000, currency: 'USD', customerEmail: 'test@example.com' } },
    { name: 'incorrect reference', pz: { reference: 'other', amount: 5000, currency: 'NGN', customerEmail: 'test@example.com' }, flw: { txRef: 'other', amount: 5000, currency: 'NGN', customerEmail: 'test@example.com' } },
    { name: 'customer identity mismatch', pz: { reference: 'REF', amount: 5000, currency: 'NGN', customerEmail: 'someone@else.com' }, flw: { txRef: 'REF', amount: 5000, currency: 'NGN', customerEmail: 'someone@else.com' } },
  ];

  for (const c of mismatchCases) {
    it(`Paystack: ${c.name} → reconciliation_required, no charge, no attempt, ref kept`, async () => {
      const sub = seedBase();
      // Echo the real reference for the "REF" placeholder so only the intended field mismatches.
      verifyPz.mockImplementation(async ({ reference }: any) => ({
        verified: true,
        conclusive: true,
        status: 'success',
        reference: c.pz.reference === 'REF' ? reference : c.pz.reference,
        amount: c.pz.amount,
        currency: c.pz.currency,
        customerEmail: c.pz.customerEmail,
        raw: {},
      }));
      await runCron();
      expect(chargePz).not.toHaveBeenCalled();
      const after = fakeDb._getSub('sub-1');
      expect(after.renewalStatus).toBe('reconciliation_required');
      expect(after.renewalAttempts).toBe(0);
      expect(after.renewalReference).toBe(sub.renewalReference);
      expect(after.status).toBe('active');
      expect(fakeDb._getTransactions()).toHaveLength(0);
    });

    it(`Flutterwave: ${c.name} → reconciliation_required, no charge, no attempt, ref kept`, async () => {
      const sub = seedBase({ renewalProvider: 'flutterwave' });
      verifyFlw.mockImplementation(async ({ txRef }: any) => ({
        verified: true,
        conclusive: true,
        status: 'successful',
        txRef: c.flw.txRef === 'REF' ? txRef : c.flw.txRef,
        amount: c.flw.amount,
        currency: c.flw.currency,
        customerEmail: c.flw.customerEmail,
        raw: {},
      }));
      await runCron();
      expect(chargeFlw).not.toHaveBeenCalled();
      const after = fakeDb._getSub('sub-1');
      expect(after.renewalStatus).toBe('reconciliation_required');
      expect(after.renewalAttempts).toBe(0);
      expect(after.renewalReference).toBe(sub.renewalReference);
      expect(after.status).toBe('active');
      expect(fakeDb._getTransactions()).toHaveLength(0);
    });
  }

  it('missing customer identity (optional) still grants entitlement once', async () => {
    const sub = seedBase();
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: undefined, raw: {} }));
    const { json } = await runCron();
    expect(json.reconciled).toBe(1);
    expect(fakeDb._getSub('sub-1').renewalStatus).toBe('idle');
    expect(fakeDb._getSub('sub-1').endAt.getTime()).toBeGreaterThan(sub.endAt.getTime());
    expect(fakeDb._getTransactions()).toHaveLength(1);
  });
});