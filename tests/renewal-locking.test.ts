import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake database with atomic state simulation
function makeFakeDb() {
  const subscriptions = new Map<string, any>();
  const transactions = new Map<string, any>();

  const now = () => new Date();

  const matchesOrConditions = (sub: any, orConditions: any[]) => {
    return orConditions.some((cond: any) => {
      if (cond.renewalStatus && sub.renewalStatus !== cond.renewalStatus) return false;
      if (cond.renewalLockedAt?.lt && !(sub.renewalLockedAt && sub.renewalLockedAt < cond.renewalLockedAt.lt)) return false;
      if (cond.updatedAt?.lt && !(sub.updatedAt && sub.updatedAt < cond.updatedAt.lt)) return false;
      return true;
    });
  };

  const db: any = {
    subscription: {
      findMany: vi.fn(async ({ where }: any) => {
        return [...subscriptions.values()].filter((sub) => {
          if (where.status && sub.status !== where.status) return false;
          if (where.autoRenew !== undefined && sub.autoRenew !== where.autoRenew) return false;
          if (where.endAt?.lte && !(sub.endAt <= where.endAt.lte)) return false;
          if (where.OR && !matchesOrConditions(sub, where.OR)) return false;
          return true;
        });
      }),
      findFirst: vi.fn(async ({ where }: any) => {
        return [...subscriptions.values()].find((sub) => sub.userId === where.userId && sub.status === where.status) ?? null;
      }),
      findUnique: vi.fn(async ({ where }: any) => subscriptions.get(where.id) ?? null),
      // Atomic updateMany: returns { count: number } representing matched & updated rows
      updateMany: vi.fn(async ({ where, data }: any) => {
        const sub = subscriptions.get(where.id);
        if (!sub) return { count: 0 };
        if (where.status && sub.status !== where.status) return { count: 0 };
        if (where.autoRenew !== undefined && sub.autoRenew !== where.autoRenew) return { count: 0 };
        if (where.endAt?.lte && !(sub.endAt <= where.endAt.lte)) return { count: 0 };

        // Check OR condition for lock eligibility
        if (where.OR && !matchesOrConditions(sub, where.OR)) return { count: 0 };

        const updated = { ...sub, ...data, updatedAt: now() };
        subscriptions.set(where.id, updated);
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
          const e: any = new Error('Unique constraint failed on providerReference');
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
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seed(sub: any) {
      subscriptions.set(sub.id, { ...sub, updatedAt: sub.updatedAt ?? now() });
    },
    _getSub: (id: string) => subscriptions.get(id),
    _getTransactions: () => [...transactions.values()],
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
  paystackChargeAuthorization: vi.fn().mockResolvedValue({ success: true, raw: { data: { id: 'txn_123' } } }),
  // No prior charge on record → stale-processing reclaim may proceed to charge.
  paystackVerifyTransaction: vi.fn().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} }),
  extractProviderTransactionId: vi.fn((raw) => raw?.data?.id ?? null),
}));

vi.mock('@/lib/providers/flutterwave', () => ({
  flutterwaveChargeToken: vi.fn().mockResolvedValue({ success: true, raw: { data: { id: 'txn_456' } } }),
  flutterwaveVerifyTransaction: vi.fn().mockResolvedValue({ verified: false, conclusive: true, status: 'failed', raw: {} }),
  extractProviderTransactionId: vi.fn((raw) => raw?.data?.id ?? null),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
  getAppUrl: vi.fn(() => 'http://localhost:3000'),
}));

describe('Subscription Auto-Renewal Locking & Concurrency', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.CRON_SECRET = 'test_cron_secret';
    process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900'; // 15 mins
  });

  it('atomically claims an idle subscription and prevents duplicate concurrent claims', async () => {
    const endAt = new Date(Date.now() + 1000 * 60 * 60); // 1 hour from now
    fakeDb._seed({
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
      updatedAt: new Date(),
      renewalReference: null,
      plan: { id: 'plan-1', name: 'VIP Pass', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-1', email: 'test@example.com', country: 'NG' },
    });

    const { GET } = await import('@/app/api/cron/renew/route');

    // Simulate Worker 1 and Worker 2 firing concurrently
    const req1 = new Request('http://localhost/api/cron/renew', {
      headers: { authorization: 'Bearer test_cron_secret' },
    });
    const req2 = new Request('http://localhost/api/cron/renew', {
      headers: { authorization: 'Bearer test_cron_secret' },
    });

    const [res1, res2] = await Promise.all([GET(req1 as any), GET(req2 as any)]);
    const json1 = await res1.json();
    const json2 = await res2.json();

    // Exactly one worker must renew; the other worker's claim must return 0 and skip
    expect(json1.renewed + json2.renewed).toBe(1);

    const sub = fakeDb._getSub('sub-1');
    expect(sub.renewalStatus).toBe('idle');
    expect(sub.renewalLockedAt).toBeNull();
    expect(sub.renewalAttempts).toBe(0);

    // Exactly one transaction created
    const txs = fakeDb._getTransactions();
    expect(txs).toHaveLength(1);
    expect(txs[0].providerReference).toBe(`renew_sub-1_${endAt.getTime()}_att1`);
  });

  it('allows reclaiming a stuck subscription if lease has expired', async () => {
    const endAt = new Date(Date.now() + 1000 * 60 * 60);
    // Locked 30 minutes ago (expired lease, threshold is 15 minutes)
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

    fakeDb._seed({
      id: 'sub-stuck',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_test_123',
      renewalAttempts: 0,
      renewalStatus: 'processing',
      renewalLockedAt: thirtyMinsAgo,
      updatedAt: thirtyMinsAgo,
      renewalReference: `renew_sub-stuck_${endAt.getTime()}_att1`,
      plan: { id: 'plan-1', name: 'VIP Pass', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-1', email: 'test@example.com', country: 'NG' },
    });

    const { GET } = await import('@/app/api/cron/renew/route');
    const req = new Request('http://localhost/api/cron/renew', {
      headers: { authorization: 'Bearer test_cron_secret' },
    });

    const res = await GET(req as any);
    const json = await res.json();

    expect(json.renewed).toBe(1);
    const sub = fakeDb._getSub('sub-stuck');
    expect(sub.renewalStatus).toBe('idle');
    expect(sub.renewalLockedAt).toBeNull();
  });

  it('blocks claiming an actively locked subscription within lease window', async () => {
    const endAt = new Date(Date.now() + 1000 * 60 * 60);
    // Locked 2 minutes ago (still inside 15-minute lease)
    const twoMinsAgo = new Date(Date.now() - 2 * 60 * 1000);

    fakeDb._seed({
      id: 'sub-active-lock',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_test_123',
      renewalAttempts: 0,
      renewalStatus: 'processing',
      renewalLockedAt: twoMinsAgo,
      updatedAt: twoMinsAgo,
      renewalReference: `renew_sub-active-lock_${endAt.getTime()}_att1`,
      plan: { id: 'plan-1', name: 'VIP Pass', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-1', email: 'test@example.com', country: 'NG' },
    });

    const { GET } = await import('@/app/api/cron/renew/route');
    const req = new Request('http://localhost/api/cron/renew', {
      headers: { authorization: 'Bearer test_cron_secret' },
    });

    const res = await GET(req as any);
    const json = await res.json();

    expect(json.renewed).toBe(0);
    // Transaction should not be created
    expect(fakeDb._getTransactions()).toHaveLength(0);
  });
});
