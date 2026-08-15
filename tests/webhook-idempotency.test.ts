import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

function makeFakeDb() {
  const transactions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let subIdCounter = 0;

  const user = { id: 'user-1', email: 'payer@example.com' };
  const plan = { id: 'plan-1', durationDays: 30, priceNGN: 4500, priceUSDOverride: null, fxMarkupPercent: null };

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
      update: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        const updated = { ...existing, ...data };
        transactions.set(where.id, updated);
        return updated;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        if (!existing) return { count: 0 };
        if (typeof where.status === 'string' && where.status !== existing.status) {
          return { count: 0 };
        }
        if (where.status?.in && !where.status.in.includes(existing.status)) {
          return { count: 0 };
        }
        const updated = { ...existing, ...data };
        transactions.set(where.id, updated);
        return { count: 1 };
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
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('handleVerifiedWebhook idempotency & validation', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret';

    fakeDb._seed({
      id: 'tx-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'paystack',
      providerReference: 'ref-abc',
      amount: 4500,
      currency: 'NGN',
      status: 'pending',
    });
  });

  it('processes a first-time webhook and activates a subscription', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: {},
    });

    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
  });

  it('no-ops on a replayed webhook for the same reference (provider retries)', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: {},
    });
    expect(fakeDb._subscriptionCount()).toBe(1);

    // Same reference again — simulates Paystack/Flutterwave retrying delivery.
    // Must NOT create a second subscription or re-process.
    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: {},
    });

    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('prevents duplicate subscription activations when two identical webhooks arrive simultaneously', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    // Execute two simultaneous webhook calls
    const [res1, res2] = await Promise.all([
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'payer@example.com',
        rawPayload: {},
      }),
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'payer@example.com',
        rawPayload: {},
      }),
    ]);

    expect(res1.status).toBe('success');
    expect(res2.status).toBe('success');
    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook whose amount does not match the pending transaction', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 999999, // tampered amount
        currencyPaid: 'NGN',
        customerEmail: 'payer@example.com',
        rawPayload: {},
      }),
    ).rejects.toThrow(/mismatch/i);

    expect(fakeDb._transactionStatus('tx-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects a webhook whose currency does not match the pending transaction', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'USD', // mismatch: expected NGN
        customerEmail: 'payer@example.com',
        rawPayload: {},
      }),
    ).rejects.toThrow(/mismatch/i);

    expect(fakeDb._transactionStatus('tx-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects a webhook whose customer email does not match the transaction user', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'attacker@evil.com', // wrong user email
        rawPayload: {},
      }),
    ).rejects.toThrow(/mismatch/i);

    expect(fakeDb._transactionStatus('tx-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });
});

describe('Paystack Webhook Endpoint (POST /api/payments/webhook/paystack)', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.PAYSTACK_SECRET_KEY = 'test_paystack_secret';

    fakeDb._seed({
      id: 'tx-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'paystack',
      providerReference: 'ref-abc',
      amount: 4500,
      currency: 'NGN',
      status: 'pending',
    });
  });

  function createSignedPaystackRequest(payloadObj: object) {
    const rawBody = JSON.stringify(payloadObj);
    const signature = crypto.createHmac('sha512', process.env.PAYSTACK_SECRET_KEY!).update(rawBody).digest('hex');

    return new NextRequest('http://localhost/api/payments/webhook/paystack', {
      method: 'POST',
      headers: {
        'x-paystack-signature': signature,
        'content-type': 'application/json',
      },
      body: rawBody,
    });
  }

  it('successfully processes a valid Paystack webhook request', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const req = createSignedPaystackRequest({
      event: 'charge.success',
      data: {
        reference: 'ref-abc',
        status: 'success',
        amount: 450000, // 4500 NGN in kobo
        currency: 'NGN',
        customer: { email: 'payer@example.com' },
      },
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('success');
    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
  });

  it('is idempotent when duplicate sequential webhooks are received at the endpoint', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const makeReq = () =>
      createSignedPaystackRequest({
        event: 'charge.success',
        data: {
          reference: 'ref-abc',
          status: 'success',
          amount: 450000,
          currency: 'NGN',
          customer: { email: 'payer@example.com' },
        },
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

  it('guarantees single subscription activation under simultaneous webhook calls to the endpoint', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const req1 = createSignedPaystackRequest({
      event: 'charge.success',
      data: {
        reference: 'ref-abc',
        status: 'success',
        amount: 450000,
        currency: 'NGN',
        customer: { email: 'payer@example.com' },
      },
    });

    const req2 = createSignedPaystackRequest({
      event: 'charge.success',
      data: {
        reference: 'ref-abc',
        status: 'success',
        amount: 450000,
        currency: 'NGN',
        customer: { email: 'payer@example.com' },
      },
    });

    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('rejects request with invalid signature header', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const req = new NextRequest('http://localhost/api/payments/webhook/paystack', {
      method: 'POST',
      headers: { 'x-paystack-signature': 'invalid_sig' },
      body: JSON.stringify({ event: 'charge.success', data: { reference: 'ref-abc' } }),
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(fakeDb._subscriptionCount()).toBe(0);
  });
});