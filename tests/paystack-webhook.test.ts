import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import crypto from 'crypto';

function makeFakeDb() {
  const transactions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let subIdCounter = 0;

  const user = { id: 'user-ps-1', email: 'paystack.user@example.com' };
  const plan = { id: 'plan-ps-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null };

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
        const id = `sub-ps-${++subIdCounter}`;
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

describe('Paystack Webhook End-to-End Idempotency & Route Security', () => {
  const SECRET_KEY = 'sk_test_paystack_secret_key_mock';

  beforeEach(() => {
    fakeDb = makeFakeDb();
    process.env.PAYSTACK_SECRET_KEY = SECRET_KEY;

    fakeDb._seed({
      id: 'tx-ps-1',
      userId: 'user-ps-1',
      planId: 'plan-ps-1',
      provider: 'paystack',
      providerReference: 'ref-ps-123456',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
    });
  });

  function signPaystackPayload(payload: string): string {
    return crypto.createHmac('sha512', SECRET_KEY).update(payload).digest('hex');
  }

  function createSignedRequest(bodyObj: any, customSignature?: string | null): NextRequest {
    const rawBody = JSON.stringify(bodyObj);
    const signature = customSignature !== undefined ? (customSignature as string) : signPaystackPayload(rawBody);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (signature) {
      headers['x-paystack-signature'] = signature;
    }

    return new NextRequest('http://localhost/api/payments/webhook/paystack', {
      method: 'POST',
      headers,
      body: rawBody,
    });
  }

  it('rejects webhooks with missing or invalid signature with 400 Bad Request', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const validPayload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
      },
    };

    // Missing signature
    const reqNoSig = createSignedRequest(validPayload, null);
    const resNoSig = await POST(reqNoSig);
    expect(resNoSig.status).toBe(400);

    // Invalid signature
    const reqBadSig = createSignedRequest(validPayload, 'invalid_hex_signature');
    const resBadSig = await POST(reqBadSig);
    expect(resBadSig.status).toBe(400);
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('first webhook succeeds, validates all fields, and activates subscription', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000, // 5000 NGN in kobo
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
        authorization: {
          authorization_code: 'AUTH_ps_code_123',
          reusable: true,
        },
      },
    };

    const req = createSignedRequest(payload);
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.status).toBe('success');
    expect(fakeDb._transactionStatus('tx-ps-1')).toBe('success');
    expect(fakeDb._transactionCompletedAt('tx-ps-1')).toBeInstanceOf(Date);
    expect(fakeDb._subscriptionCount()).toBe(1);

    const subs = fakeDb._getSubscriptions();
    expect(subs[0].userId).toBe('user-ps-1');
    expect(subs[0].status).toBe('active');
  });

  it('second identical webhook does not extend subscription again (replay idempotency)', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
      },
    };

    // First delivery
    const res1 = await POST(createSignedRequest(payload));
    expect(res1.status).toBe(200);
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);

    const initialSubs = fakeDb._getSubscriptions();
    const originalEndAt = initialSubs[0].endAt;

    // Second delivery of same identical webhook
    const res2 = await POST(createSignedRequest(payload));
    const json2 = await res2.json();

    expect(res2.status).toBe(200);
    expect(json2.status).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
    expect(fakeDb.subscription.update).not.toHaveBeenCalled();
    expect(initialSubs[0].endAt).toEqual(originalEndAt);
  });

  it('two simultaneous webhook calls cannot create duplicate subscription benefits', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
      },
    };

    const req1 = createSignedRequest(payload);
    const req2 = createSignedRequest(payload);

    // Concurrent simultaneous webhook execution
    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const json1 = await res1.json();
    const json2 = await res2.json();
    expect(json1.status).toBe('success');
    expect(json2.status).toBe('success');

    // Exactly one subscription created, zero duplicate extensions
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
    expect(fakeDb.subscription.update).not.toHaveBeenCalled();
  });

  it('rejects webhook with expected amount mismatch', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 10000, // 100 NGN instead of expected 5000 NGN
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
      },
    };

    const res = await POST(createSignedRequest(payload));
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-ps-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects webhook with expected currency mismatch', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000,
        currency: 'USD', // Expected NGN
        customer: { email: 'paystack.user@example.com' },
      },
    };

    const res = await POST(createSignedRequest(payload));
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-ps-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects webhook with expected user email mismatch', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'ref-ps-123456',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'attacker@evil.com' }, // Mismatch
      },
    };

    const res = await POST(createSignedRequest(payload));
    expect(res.status).toBe(400);
    expect(fakeDb._transactionStatus('tx-ps-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('rejects webhook with unknown transaction reference', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'charge.success',
      data: {
        reference: 'unknown_reference_xyz',
        status: 'success',
        amount: 500000,
        currency: 'NGN',
        customer: { email: 'paystack.user@example.com' },
      },
    };

    const res = await POST(createSignedRequest(payload));
    expect(res.status).toBe(400);
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('handles non-charge.success events gracefully without altering state', async () => {
    const { POST } = await import('@/app/api/payments/webhook/paystack/route');

    const payload = {
      event: 'transfer.success',
      data: { reference: 'transfer_ref_1' },
    };

    const res = await POST(createSignedRequest(payload));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.received).toBe(true);
    expect(fakeDb._transactionStatus('tx-ps-1')).toBe('pending');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });
});
