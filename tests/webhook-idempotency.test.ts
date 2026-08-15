import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal in-memory fake standing in for Prisma — enough to exercise the
// actual idempotency branch in handleVerifiedWebhook (the part that matters:
// "already processed" short-circuits before any subscription math runs)
// without mocking every individual Prisma call shape.
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
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('handleVerifiedWebhook idempotency', () => {
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

  it('processes a first-time webhook and activates a subscription', async () => {
    const { handleVerifiedWebhook } = await import('@/lib/payments');

    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
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
      rawPayload: {},
    });
    expect(fakeDb._subscriptionCount()).toBe(1);

    // Same reference again — simulates Paystack/Flutterwave retrying
    // delivery. Must NOT create a second subscription or re-process.
    await handleVerifiedWebhook({
      providerReference: 'ref-abc',
      status: 'success',
      amountPaid: 4500,
      currencyPaid: 'NGN',
      rawPayload: {},
    });

    expect(fakeDb._subscriptionCount()).toBe(1);
    // subscription.create should have been called exactly once across both webhook calls
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
    expect(fakeDb._subscriptionCount()).toBe(0);
  });
});
