import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/fx', () => ({ getFxRate: vi.fn().mockResolvedValue(1600) }));

import { resolvePrice, toMinorUnits } from '@/lib/payments';

describe('toMinorUnits', () => {
  it('converts a major-unit amount to the smallest currency unit', () => {
    expect(toMinorUnits(4500, 'NGN')).toBe(450000);
    expect(toMinorUnits(9.99, 'USD')).toBe(999);
  });
});

describe('resolvePrice', () => {
  const plan = { priceNGN: 4500, priceUSDOverride: null, fxMarkupPercent: null };

  it('charges NGN directly for Nigerian users', async () => {
    const result = await resolvePrice(plan, 'NG');
    expect(result.currency).toBe('NGN');
    expect(result.amount).toBe(4500);
    expect(result.fxRateUsed).toBeUndefined();
  });

  it('converts to USD via FX rate for non-Nigerian users', async () => {
    const result = await resolvePrice(plan, 'US');
    expect(result.currency).toBe('USD');
    expect(result.amount).toBeCloseTo(4500 * 1600, 5);
    expect(result.fxRateUsed).toBe(1600);
  });

  it('applies the plan FX markup on top of the converted price', async () => {
    const markedUpPlan = { ...plan, fxMarkupPercent: 10 };
    const result = await resolvePrice(markedUpPlan, 'US');
    expect(result.amount).toBeCloseTo(4500 * 1600 * 1.1, 5);
  });

  it('uses priceUSDOverride instead of FX conversion when set', async () => {
    const overridePlan = { ...plan, priceUSDOverride: 9.99 };
    const result = await resolvePrice(overridePlan, 'GB');
    expect(result.amount).toBe(9.99);
    expect(result.fxRateUsed).toBeUndefined();
  });
});

const paymentRefCapture = { current: '' };

describe('payment reference uniqueness', () => {
  it('generates a reference with the expected pp_ prefix', async () => {
    const mockPrisma = vi.hoisted(() => ({
      user: {
        findUniqueOrThrow: vi.fn(async () => ({ id: 'u-1', email: 'u@test.com', country: 'NG' })),
      },
      plan: {
        findUniqueOrThrow: vi.fn(async () => ({ id: 'p-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null })),
      },
      transaction: {
        create: vi.fn(async ({ data }: any) => {
          paymentRefCapture.current = data.providerReference;
          return { id: 'tx-1', ...data };
        }),
      },
    }));

    const mockPaystack = vi.hoisted(() => ({
      paystackInitialize: vi.fn().mockResolvedValue({ authorizationUrl: 'https://checkout.paystack.com/test' }),
    }));

    vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
    vi.mock('@/lib/providers/paystack', () => mockPaystack);

    process.env.APP_URL = 'http://localhost:3000';

    const { initializePayment } = await import('@/lib/payments');
    const result = await initializePayment('u-1', 'p-1', 'paystack');
    expect(result.transactionId).toBe('tx-1');
    expect(paymentRefCapture.current).toBeDefined();
    expect(paymentRefCapture.current.startsWith('pp_')).toBe(true);
  });
});
