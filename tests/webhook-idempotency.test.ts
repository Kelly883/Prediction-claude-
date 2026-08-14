import { describe, it, expect, vi, beforeEach } from 'vitest';

// In-memory fake standing in for Prisma — exercising atomic state transitions,
// idempotency, and tamper-resistance in handleVerifiedWebhook
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
    _seed(tx: any, user?: any) {
      transactions.set(tx.id, { ...tx, user: user ?? { id: tx.userId, email: 'user@example.com' } });
    },
    _subscriptionCount: () => subscriptions.size,
    _getSub: (id: string) => subscriptions.get(id),
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

describe('handleVerifiedWebhook Paystack Idempotency & Concurrency', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    fakeDb._seed({
      id: 'tx-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'paystack',
      providerReference: 'ref-paystack-123',
      amount: 4500,
      currency: 'NGN',
      status: 'pending',
    });
  });

  it('first webhook succeeds and transitions pending -> success atomically', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    const result = await handleVerifiedWebhook({
      providerReference: 'ref-paystack-123',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: { event: 'charge.success' },
    });

    expect(result.status).toBe('success');
    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._transactionCompletedAt('tx-1')).toBeInstanceOf(Date);
    expect(fakeDb._subscriptionCount()).toBe(1);
  });

  it('second identical webhook does not extend subscription again (replay defense)', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    // First delivery
    await handleVerifiedWebhook({
      providerReference: 'ref-paystack-123',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: { delivery: 1 },
    });
    expect(fakeDb._subscriptionCount()).toBe(1);
    const subAfterFirst = (fakeDb as any)._getSub('sub-1');

    const initialSubs = fakeDb._getSubscriptions();
    const initialEndAt = initialSubs[0].endAt;

    // Second delivery of same webhook
    const replayResult = await handleVerifiedWebhook({
      providerReference: 'ref-paystack-123',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      customerEmail: 'payer@example.com',
      rawPayload: { delivery: 2 },
    });

    expect(replayResult.status).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
    expect(fakeDb.subscription.update).not.toHaveBeenCalled();
    const subAfterSecond = (fakeDb as any)._getSub('sub-1');
    expect(subAfterSecond.endAt.getTime()).toBe(subAfterFirst.endAt.getTime());
    expect(initialSubs[0].endAt).toEqual(initialEndAt);
  });

  it('two simultaneous webhook calls cannot create duplicate subscription benefits', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    // 2 parallel concurrent webhook calls hitting at the same time
    const [res1, res2] = await Promise.all([
      handleVerifiedWebhook({
        providerReference: 'ref-paystack-123',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'payer@example.com',
        rawPayload: { worker: 1 },
      }),
      handleVerifiedWebhook({
        providerReference: 'ref-paystack-123',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'payer@example.com',
        rawPayload: { worker: 2 },
      }),
    ]);

    expect(res1.status).toBe('success');
    expect(res2.status).toBe('success');
    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
  });

  it('rejects a webhook with a tampered customer email', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-paystack-123',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'attacker@evil.com', // doesn't match payer@example.com
        rawPayload: {},
      }),
    ).rejects.toThrow(/mismatch/i);

    expect(fakeDb._transactionStatus('tx-1')).toBe('failed');
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('validates expected user / email mismatch and rejects', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-paystack-123',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        rawPayload: {},
        expectedUserId: 'wrong-user-id',
      }),
    ).rejects.toThrow(/Transaction verification mismatch/i);

    // Reset tx-1 status back to pending for the next check
    fakeDb._seed({
      id: 'tx-1',
      userId: 'user-1',
      planId: 'plan-1',
      provider: 'paystack',
      providerReference: 'ref-paystack-123',
      amount: 4500,
      currency: 'NGN',
      status: 'pending',
    });

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-paystack-123',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        customerEmail: 'wrong@example.com',
        rawPayload: { data: { customer: { email: 'wrong@example.com' } } },
      }),
    ).rejects.toThrow(/Transaction verification mismatch/i);
  });
});
