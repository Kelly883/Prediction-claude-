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
