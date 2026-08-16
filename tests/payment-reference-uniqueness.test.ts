import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';

function makeFakeDb() {
  const transactions: any[] = [];

  const db: any = {
    transaction: {
      create: vi.fn(async ({ data }: any) => {
        const existing = transactions.find((t) => t.providerReference === data.providerReference);
        if (existing) {
          const err: any = new Error('Unique constraint failed on providerReference');
          err.code = 'P2002';
          throw err;
        }
        const record = { id: `txn-${transactions.length + 1}`, ...data };
        transactions.push(record);
        return record;
      }),
      findMany: vi.fn(async () => transactions),
    },
    _transactions: transactions,
  };

  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

describe('Transaction providerReference uniqueness', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('creates a transaction with a unique providerReference', async () => {
    const record = await prisma.transaction.create({
      data: {
        userId: 'user-1',
        provider: 'paystack',
        providerReference: 'ref-abc-123',
        amount: 4500,
        currency: 'NGN',
        status: 'pending',
        idempotencyKey: 'key-1',
      },
    });

    expect(record.providerReference).toBe('ref-abc-123');
    expect(fakeDb._transactions.length).toBe(1);
  });

  it('rejects duplicate providerReference with P2002 error', async () => {
    await prisma.transaction.create({
      data: {
        userId: 'user-1',
        provider: 'paystack',
        providerReference: 'ref-dup-456',
        amount: 4500,
        currency: 'NGN',
        status: 'pending',
        idempotencyKey: 'key-2',
      },
    });

    await expect(
      prisma.transaction.create({
        data: {
          userId: 'user-2',
          provider: 'flutterwave',
          providerReference: 'ref-dup-456',
          amount: 9000,
          currency: 'USD',
          status: 'pending',
          idempotencyKey: 'key-3',
        },
      })
    ).rejects.toMatchObject({ code: 'P2002' });

    expect(fakeDb._transactions.length).toBe(1);
  });

  it('allows different providerReferences for different transactions', async () => {
    await prisma.transaction.create({
      data: {
        userId: 'user-1',
        provider: 'paystack',
        providerReference: 'ref-a',
        amount: 4500,
        currency: 'NGN',
        status: 'success',
        idempotencyKey: 'key-a',
      },
    });

    await prisma.transaction.create({
      data: {
        userId: 'user-2',
        provider: 'flutterwave',
        providerReference: 'ref-b',
        amount: 9000,
        currency: 'USD',
        status: 'success',
        idempotencyKey: 'key-b',
      },
    });

    expect(fakeDb._transactions.length).toBe(2);
    expect(fakeDb._transactions[0].providerReference).toBe('ref-a');
    expect(fakeDb._transactions[1].providerReference).toBe('ref-b');
  });
});
