import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal in-memory fake standing in for Prisma — exercising
// atomic state transitions and idempotency in handleVerifiedWebhook
function makeFakeDb() {
  const transactions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let subIdCounter = 0;

  const plan = { id: 'plan-1', durationDays: 30, priceNGN: 4500, priceUSDOverride: null, fxMarkupPercent: null };

  const db: any = {
    transaction: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.providerReference) {
          return [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null;
        }
        return transactions.get(where.id) ?? null;
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: any) => {
        const found = where.providerReference
          ? [...transactions.values()].find((t) => t.providerReference === where.providerReference)
          : transactions.get(where.id);
        if (!found) throw new Error('Transaction not found');
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
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('handleVerifiedWebhook idempotency & atomic state transitions', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
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

  it('processes a first-time webhook, transitions pending -> success atomically, and sets completedAt', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      rawPayload: {},
    });

    expect(fakeDb._transactionStatus('tx-1')).toBe('success');
    expect(fakeDb._transactionCompletedAt('tx-1')).toBeInstanceOf(Date);
    expect(fakeDb._subscriptionCount()).toBe(1);
  });

  it('no-ops on a replayed webhook for the same reference (provider retries) and does not extend subscription again', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      rawPayload: {},
    });
    expect(fakeDb._subscriptionCount()).toBe(1);
    const subAfterFirst = (fakeDb as any)._getSub('sub-1');

    // Same reference again — simulates Paystack/Flutterwave retrying delivery
    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      rawPayload: {},
    });

    expect(fakeDb._subscriptionCount()).toBe(1);
    expect(fakeDb.subscription.create).toHaveBeenCalledTimes(1);
    expect(fakeDb.subscription.update).not.toHaveBeenCalled();
    const subAfterSecond = (fakeDb as any)._getSub('sub-1');
    expect(subAfterSecond.endAt.getTime()).toBe(subAfterFirst.endAt.getTime());
  });

  it('atomically handles simultaneous concurrent webhook deliveries without duplicate activation', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    // Simulate 2 parallel webhook deliveries hitting at the exact same millisecond
    const [res1, res2] = await Promise.all([
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        rawPayload: { event: 'delivery_1' },
      }),
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        rawPayload: { event: 'delivery_2' },
      }),
    ]);

    expect(res1.status).toBe('success');
    expect(res2.status).toBe('success');
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
        rawPayload: {},
      }),
    ).rejects.toThrow(/mismatch/i);

    expect(fakeDb._transactionStatus('tx-1')).toBe('failed');
    expect(fakeDb._transactionCompletedAt('tx-1')).toBeInstanceOf(Date);
    expect(fakeDb._subscriptionCount()).toBe(0);
  });

  it('validates expected user / email mismatch and rejects', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        rawPayload: {},
        expectedUserId: 'wrong-user-id',
      }),
    ).rejects.toThrow(/User mismatch/i);

    await expect(
      handleVerifiedWebhook({
        providerReference: 'ref-abc',
        status: 'success',
        amountPaid: 4500,
        currencyPaid: 'NGN',
        rawPayload: { data: { customer: { email: 'wrong@example.com' } } },
      }),
    ).rejects.toThrow(/User mismatch/i);
  });
});
