import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeFakeDb() {
  const transactions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let subIdCounter = 0;

  const user = { id: 'user-1', email: 'payer@example.com' };
  const plan = { id: 'plan-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null };

  const db: any = {
    transaction: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        let found: any = null;
        if (where.providerReference) {
          found = [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null;
        } else if (where.id) {
          found = transactions.get(where.id) ?? null;
        }
        if (found && include?.user) {
          return { ...found, user };
        }
        return found;
      }),
      findUniqueOrThrow: vi.fn(async ({ where, include }: any) => {
        let found: any = null;
        if (where.providerReference) {
          found = [...transactions.values()].find((t) => t.providerReference === where.providerReference);
        } else if (where.id) {
          found = transactions.get(where.id);
        }
        if (!found) throw new Error('Transaction not found');
        if (include?.user) {
          return { ...found, user };
        }
        return found;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        if (!existing) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(existing.status)) {
          return { count: 0 };
        }
        const updated = { ...existing, ...data };
        transactions.set(where.id, updated);
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        const updated = { ...existing, ...data };
        transactions.set(where.id, updated);
        return updated;
      }),
    },
    plan: { findUnique: vi.fn(async () => plan) },
    subscription: {
      findFirst: vi.fn(async () => [...subscriptions.values()][0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        const id = `sub-${++subIdCounter}`;
        const record = { id, ...data };
        subscriptions.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = subscriptions.get(where.id);
        const updated = { ...existing, ...data };
        subscriptions.set(where.id, updated);
        return updated;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seed(tx: any) {
      transactions.set(tx.id, tx);
    },
    _subscriptionCount: () => subscriptions.size,
    _transactionStatus: (id: string) => transactions.get(id)?.status,
    _transactionCompletedAt: (id: string) => transactions.get(id)?.completedAt,
    _getSubscriptions: () => [...subscriptions.values()],
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

// Mock the Flutterwave API verification function
const mockFlutterwaveVerify = vi.fn();
vi.mock('@/lib/providers/flutterwave', async () => {
  const actual = await vi.importActual<any>('@/lib/providers/flutterwave');
  return {
    ...actual,
    flutterwaveVerifyTransaction: (params: any) => mockFlutterwaveVerify(params),
  };
});

describe('Flutterwave Webhook Hardening & Verification', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH = 'test_flw_secret_hash';

    fakeDb._seed({
      id: 'tx-flw-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'flutterwave',
      providerReference: 'ref-flw-123',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
    });
  });

  it('processes a successful transaction with verified provider data', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'ref-flw-123',
      amount: 5000,
      currency: 'NGN',
      status: 'successful',
      customerEmail: 'payer@example.com',
      reusableToken: 'CARD_TOKEN_123',
      raw: { id: 999 },
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const req = new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
      method: 'POST',
      headers: {
        'verif-hash': 'test_flw_secret_hash',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 999, tx_ref: 'ref-flw-123', status: 'successful', amount: 5000, currency: 'NGN' },
      }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('success');
    expect(fakeDb._transactionStatus('tx-flw-1')).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
  });

  it('is idempotent on duplicate webhook calls (second call does not create extra subscriptions)', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'ref-flw-123',
      amount: 5000,
      currency: 'NGN',
      status: 'successful',
      customerEmail: 'payer@example.com',
      reusableToken: 'CARD_TOKEN_123',
      raw: { id: 999 },
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const makeReq = () =>
      new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
        method: 'POST',
        headers: { 'verif-hash': 'test_flw_secret_hash' },
        body: JSON.stringify({
          event: 'charge.completed',
          data: { id: 999, tx_ref: 'ref-flw-123', status: 'successful', amount: 5000, currency: 'NGN' },
        }),
      });

    // 1st delivery
    const res1 = await POST(makeReq());
    expect(res1.status).toBe(200);
    expect(fakeDb._subscriptionCount()).toBe(1);

    // 2nd duplicate delivery
    const res2 = await POST(makeReq());
    expect(res2.status).toBe(200);
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook with wrong amount verified from provider API', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'ref-flw-123',
      amount: 100, // attacker tried paying 100 instead of 5000
      currency: 'NGN',
      status: 'successful',
      customerEmail: 'payer@example.com',
      raw: {},
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const req = new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
      method: 'POST',
      headers: { 'verif-hash': 'test_flw_secret_hash' },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 999, tx_ref: 'ref-flw-123', status: 'successful', amount: 5000, currency: 'NGN' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-flw-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects a webhook with wrong currency verified from provider API', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'ref-flw-123',
      amount: 5000,
      currency: 'USD', // DB expected NGN
      status: 'successful',
      customerEmail: 'payer@example.com',
      raw: {},
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const req = new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
      method: 'POST',
      headers: { 'verif-hash': 'test_flw_secret_hash' },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 999, tx_ref: 'ref-flw-123', status: 'successful', amount: 5000, currency: 'NGN' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-flw-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects a webhook with an unknown / wrong reference', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'non_existent_ref',
      amount: 5000,
      currency: 'NGN',
      status: 'successful',
      raw: {},
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const req = new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
      method: 'POST',
      headers: { 'verif-hash': 'test_flw_secret_hash' },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 999, tx_ref: 'non_existent_ref', status: 'successful', amount: 5000, currency: 'NGN' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('handles a failed transaction from the provider API properly', async () => {
    mockFlutterwaveVerify.mockResolvedValue({
      verified: true,
      txRef: 'ref-flw-123',
      amount: 5000,
      currency: 'NGN',
      status: 'failed',
      raw: {},
    });

    const { POST } = await import('@/app/api/payments/webhook/flutterwave/route');
    const req = new NextRequest('http://localhost/api/payments/webhook/flutterwave', {
      method: 'POST',
      headers: { 'verif-hash': 'test_flw_secret_hash' },
      body: JSON.stringify({
        event: 'charge.completed',
        data: { id: 999, tx_ref: 'ref-flw-123', status: 'failed', amount: 5000, currency: 'NGN' },
      }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-flw-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });
});
