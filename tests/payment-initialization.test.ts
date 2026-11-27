import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUniqueOrThrow: vi.fn() },
  plan: { findUniqueOrThrow: vi.fn() },
  transaction: { create: vi.fn(), update: vi.fn() },
}));

const mockPaystack = vi.hoisted(() => ({ paystackInitialize: vi.fn() }));
const mockFlutterwave = vi.hoisted(() => ({ flutterwaveInitialize: vi.fn() }));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/fx', () => ({ getFxRate: vi.fn().mockResolvedValue(1600) }));
vi.mock('@/lib/providers/paystack', () => mockPaystack);
vi.mock('@/lib/providers/flutterwave', () => mockFlutterwave);
vi.mock('@/lib/encryption', () => ({ encryptPaymentToken: vi.fn((t: string) => `enc(${t})`) }));
vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));
vi.mock('@/lib/env', () => ({
  requireAppUrl: () => 'https://app.test',
  requirePaystack: vi.fn(),
  requireFlutterwave: vi.fn(),
  getEnv: () => ({}),
}));

import { initializePayment } from '@/lib/payments';
import { ProviderInitError } from '@/lib/providers/init-error';

const plan = { id: 'plan-1', durationDays: 30, priceNGN: 4500, priceUSDOverride: null, fxMarkupPercent: null };
const user = { id: 'user-1', email: 'payer@example.com', country: 'NG' };

function resetMocks() {
  vi.clearAllMocks();
  mockPrisma.user.findUniqueOrThrow.mockResolvedValue(user);
  mockPrisma.plan.findUniqueOrThrow.mockResolvedValue(plan);
  mockPrisma.transaction.create.mockImplementation(async ({ data }: any) => ({ id: 'tx-1', ...data }));
  mockPrisma.transaction.update.mockResolvedValue({});
  mockPaystack.paystackInitialize.mockResolvedValue({ authorizationUrl: 'https://paystack.test/checkout' });
  mockFlutterwave.flutterwaveInitialize.mockResolvedValue({ paymentLink: 'https://flutterwave.test/pay' });
}

describe('initializePayment (P-02 ordering & failure handling)', () => {
  beforeEach(resetMocks);

  it('persists the pending transaction BEFORE calling the provider', async () => {
    const order: string[] = [];
    mockPrisma.transaction.create.mockImplementation(async ({ data }: any) => {
      order.push('create');
      return { id: 'tx-1', ...data };
    });
    mockPaystack.paystackInitialize.mockImplementation(async () => {
      order.push('provider');
      return { authorizationUrl: 'https://paystack.test/checkout' };
    });

    const result = await initializePayment('user-1', 'plan-1', 'paystack');

    expect(order).toEqual(['create', 'provider']);
    expect(result.transactionId).toBe('tx-1');
    expect(mockPrisma.transaction.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'pending', providerReference: expect.stringMatching(/^pp_/) }) }),
    );
  });

  it('does NOT call the provider when the DB insert fails', async () => {
    mockPrisma.transaction.create.mockRejectedValue(new Error('db insert failed'));

    await expect(initializePayment('user-1', 'plan-1', 'paystack')).rejects.toThrow('db insert failed');
    expect(mockPaystack.paystackInitialize).not.toHaveBeenCalled();
    expect(mockFlutterwave.flutterwaveInitialize).not.toHaveBeenCalled();
  });

  it('marks the transaction failed on a DEFINITIVE provider rejection', async () => {
    mockPaystack.paystackInitialize.mockRejectedValue(new ProviderInitError('provider said no', true));

    await expect(initializePayment('user-1', 'plan-1', 'paystack')).rejects.toThrow('provider said no');

    expect(mockPrisma.transaction.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'tx-1' },
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('PRESERVES the pending transaction on an UNCERTAIN provider timeout', async () => {
    mockFlutterwave.flutterwaveInitialize.mockRejectedValue(new Error('ETIMEDOUT'));

    await expect(initializePayment('user-1', 'plan-1', 'flutterwave')).rejects.toThrow('ETIMEDOUT');

    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
  });

  it('PRESERVES the pending transaction on an UNCERTAIN ProviderInitError (e.g. 5xx/429/408)', async () => {
    mockPaystack.paystackInitialize.mockRejectedValue(new ProviderInitError('ambiguous (HTTP 503)', false));

    await expect(initializePayment('user-1', 'plan-1', 'paystack')).rejects.toThrow('ambiguous');

    // definitive === false → must NOT mark failed; pending is preserved.
    expect(mockPrisma.transaction.update).not.toHaveBeenCalled();
  });

  it('retries create distinct references/transactions (no duplicate reference reuse)', async () => {
    let n = 0;
    const refs: string[] = [];
    mockPrisma.transaction.create.mockImplementation(async ({ data }: any) => {
      refs.push(data.providerReference);
      return { id: `tx-${++n}`, ...data };
    });

    await initializePayment('user-1', 'plan-1', 'paystack');
    await initializePayment('user-1', 'plan-1', 'paystack');

    expect(mockPrisma.transaction.create).toHaveBeenCalledTimes(2);
    expect(new Set(refs).size).toBe(2);
    expect(refs.every((r) => r.startsWith('pp_'))).toBe(true);
  });

  it('formats Paystack amounts in minor units and Flutterwave in major units', async () => {
    await initializePayment('user-1', 'plan-1', 'paystack');
    expect(mockPaystack.paystackInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ amountMinorUnits: 450000, currency: 'NGN' }),
    );

    resetMocks();
    await initializePayment('user-1', 'plan-1', 'flutterwave');
    expect(mockFlutterwave.flutterwaveInitialize).toHaveBeenCalledWith(
      expect.objectContaining({ amount: 4500, currency: 'NGN' }),
    );
  });
});