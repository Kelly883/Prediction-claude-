import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake database with atomic state simulation
function makeFakeDb() {
  const subscriptions = new Map<string, any>();
  const transactions = new Map<string, any>();

  const db: any = {
    subscription: {
      findMany: vi.fn(async ({ where }: any) => {
        return [...subscriptions.values()].filter((sub) => {
          if (where.status && sub.status !== where.status) return false;
          if (where.autoRenew !== undefined && sub.autoRenew !== where.autoRenew) return false;
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

        // Check OR condition for lock eligibility
        if (where.OR) {
          const matchesOr = where.OR.some((cond: any) => {
            if (cond.renewalStatus && sub.renewalStatus !== cond.renewalStatus) return false;
            if (cond.renewalLockedAt?.lt && !(sub.renewalLockedAt < cond.renewalLockedAt.lt)) return false;
            return true;
          });
          if (!matchesOr) return { count: 0 };
        }

        const updated = { ...sub, ...data };
        subscriptions.set(where.id, updated);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const sub = subscriptions.get(where.id);
        const updated = { ...sub, ...data };
        subscriptions.set(where.id, updated);
        return updated;
      }),
    },
    transaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.providerReference) {
          return [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null;
        }
        return transactions.get(where.id) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `tx-${transactions.size + 1}`;
        const record = { id, ...data };
        transactions.set(id, record);
        return record;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seed(sub: any) {
      subscriptions.set(sub.id, sub);
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
  paystackChargeAuthorization: vi.fn().mockResolvedValue({ success: true, raw: { id: 123 } }),
}));

vi.mock('@/lib/providers/flutterwave', () => ({
  flutterwaveChargeToken: vi.fn().mockResolvedValue({ success: true, raw: { id: 456 } }),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: vi.fn().mockResolvedValue(true),
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

  it('defaults to 15-minute lease timeout when RENEWAL_LOCK_TIMEOUT_SECONDS is invalid or negative', async () => {
    process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = 'invalid_number';

    const endAt = new Date(Date.now() + 1000 * 60 * 60);
    // Locked 10 minutes ago (within 15 minute lease window -> should NOT be reclaimable)
    const tenMinsAgo = new Date(Date.now() - 10 * 60 * 1000);

    fakeDb._seed({
      id: 'sub-fallback-lock',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_test_123',
      renewalAttempts: 0,
      renewalStatus: 'processing',
      renewalLockedAt: tenMinsAgo,
      renewalReference: `renew_sub-fallback-lock_${endAt.getTime()}_att1`,
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
  });
});
