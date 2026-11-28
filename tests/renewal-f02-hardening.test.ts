import { describe, it, expect, vi, beforeEach } from 'vitest';

// F-02.9 hardening tests. Fake Prisma models atomic updateMany (incl. endAt and
// updatedAt guards), findUnique(select), and a $transaction hook to simulate a
// concurrent webhook. Providers are mocked. No real Postgres/provider calls.

const DAY = 24 * 60 * 60 * 1000;

function makeFakeDb() {
  const subs = new Map<string, any>();
  const txs = new Map<string, any>();
  const db: any = {
    _beforeTx: null as null | (() => void),
    subscription: {
      findMany: vi.fn(async ({ where }: any) =>
        [...subs.values()].filter((s) => {
          if (where.status && s.status !== where.status) return false;
          if (where.autoRenew !== undefined && s.autoRenew !== where.autoRenew) return false;
          if (where.endAt?.lte && !(s.endAt <= where.endAt.lte)) return false;
          if (where.OR) {
            const ok = where.OR.some((c: any) => {
              if (c.renewalStatus && s.renewalStatus !== c.renewalStatus) return false;
              if (c.renewalLockedAt?.lt && !(s.renewalLockedAt && s.renewalLockedAt < c.renewalLockedAt.lt)) return false;
              if (c.updatedAt?.lt && !(s.updatedAt && s.updatedAt < c.updatedAt.lt)) return false;
              return true;
            });
            if (!ok) return false;
          }
          return true;
        })
      ),
      findUnique: vi.fn(async ({ where }: any) => subs.get(where.id) ?? null),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const s = subs.get(where.id);
        if (!s) return { count: 0 };
        if (where.status && s.status !== where.status) return { count: 0 };
        if (where.autoRenew !== undefined && s.autoRenew !== where.autoRenew) return { count: 0 };
        if (where.endAt && s.endAt.getTime() !== where.endAt.getTime()) return { count: 0 };
        if (where.OR) {
          const ok = where.OR.some((c: any) => {
            if (c.renewalStatus && s.renewalStatus !== c.renewalStatus) return false;
            if (c.renewalLockedAt?.lt && !(s.renewalLockedAt && s.renewalLockedAt < c.renewalLockedAt.lt)) return false;
            if (c.updatedAt?.lt && !(s.updatedAt && s.updatedAt < c.updatedAt.lt)) return false;
            return true;
          });
          if (!ok) return { count: 0 };
        }
        subs.set(where.id, { ...s, ...data, updatedAt: new Date() });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const s = subs.get(where.id);
        const u = { ...s, ...data, updatedAt: new Date() };
        subs.set(where.id, u);
        return u;
      }),
    },
    transaction: {
      findUnique: vi.fn(async ({ where }: any) => [...txs.values()].find((t) => t.providerReference === where.providerReference) ?? null),
      create: vi.fn(async ({ data }: any) => {
        const r = { id: `tx-${txs.size + 1}`, ...data };
        txs.set(data.providerReference, r);
        return r;
      }),
    },
    $transaction: vi.fn(async (fn: any) => {
      if (db._beforeTx) db._beforeTx();
      return fn(db);
    }),
    _seed(s: any) {
      subs.set(s.id, s);
    },
    _getSub: (id: string) => subs.get(id),
    _getTxs: () => [...txs.values()],
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
const chargePz = paystackChargeAuthorization as unknown as ReturnType<typeof vi.fn>;
const verifyPz = paystackVerifyTransaction as unknown as ReturnType<typeof vi.fn>;

function seed(overrides: any = {}) {
  const endAt = new Date(Date.now() + 60 * 60 * 1000);
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
  const req = new Request('http://localhost/api/cron/renew', { headers: { authorization: 'Bearer test_cron_secret' } });
  const res = await GET(req as any);
  return { json: await res.json() };
}

beforeEach(() => {
  fakeDb = makeFakeDb();
  process.env.CRON_SECRET = 'test_cron_secret';
  process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900';
  delete process.env.RENEWAL_RECOVERY_INTERVAL_SECONDS;
  chargePz.mockReset().mockResolvedValue({ success: true, raw: { id: 1 } });
  verifyPz.mockReset().mockResolvedValue({ verified: false, conclusive: false, status: 'failed', raw: {} });
});

describe('F-02.9 concurrency & recovery', () => {
  it('concurrent reconciliation claims → only one worker verifies/charges', async () => {
    seed();
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const [a, b] = await Promise.all([runCron(), runCron()]);
    const total = a.json.reconciled + b.json.reconciled + a.json.renewed + b.json.renewed;
    expect(total).toBe(1);
    expect(verifyPz).toHaveBeenCalledTimes(1);
    expect(fakeDb._getTxs()).toHaveLength(1);
  });

  it('worker crash recovery: stale processing (old updatedAt) is reclaimed and reconciled', async () => {
    seed({ renewalStatus: 'processing', renewalLockedAt: new Date(Date.now() - 30 * 60 * 1000), updatedAt: new Date(Date.now() - 30 * 60 * 1000) });
    verifyPz.mockImplementation(async ({ reference }: any) => ({ verified: true, conclusive: true, status: 'success', reference, amount: 5000, currency: 'NGN', customerEmail: 'test@example.com', raw: {} }));
    const { json } = await runCron();
    expect(verifyPz).toHaveBeenCalledTimes(1);
    expect(json.reconciled + json.renewed).toBe(1);
  });

  it('webhook/cron race: cron does not overwrite a newer webhook endAt (no shortening)', async () => {
    const sub = seed({ renewalStatus: 'idle', renewalLockedAt: null, renewalReference: null });
    // Simulate a webhook advancing endAt by 40 days inside the transaction.
    fakeDb._beforeTx = () => {
      const s = fakeDb._getSub('sub-1');
      s.endAt = new Date(s.endAt.getTime() + 40 * DAY);
    };
    await runCron();
    const after = fakeDb._getSub('sub-1');
    // duration 30d from the webhook-advanced endAt (not the stale snapshot).
    expect(after.endAt.getTime()).toBe(sub.endAt.getTime() + 70 * DAY);
  });

  it('provider timeout (AbortError) → unknown, no charge, reconciliation_required', async () => {
    const sub = seed();
    verifyPz.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await runCron();
    expect(chargePz).not.toHaveBeenCalled();
    const after = fakeDb._getSub('sub-1');
    expect(after.renewalStatus).toBe('reconciliation_required');
    expect(after.renewalAttempts).toBe(0);
    expect(after.renewalReference).toBe(sub.renewalReference);
  });

  it('invalid throttle env (Infinity) falls back to default without crashing', async () => {
    process.env.RENEWAL_RECOVERY_INTERVAL_SECONDS = 'Infinity';
    vi.resetModules();
    seed({ renewalLockedAt: new Date(Date.now() - 8 * DAY), updatedAt: new Date() });
    verifyPz.mockResolvedValue({ verified: true, conclusive: true, status: 'pending', raw: {} });
    const { json } = await runCron();
    // Default 6h interval + last attempt now → throttled (no verify), no crash.
    expect(verifyPz).not.toHaveBeenCalled();
    expect(json.errors).toBeDefined();
    delete process.env.RENEWAL_RECOVERY_INTERVAL_SECONDS;
  });
});