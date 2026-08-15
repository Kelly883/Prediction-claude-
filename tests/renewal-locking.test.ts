import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => {
  const mockPrisma: any = {
    subscription: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    transaction: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
  };

  const mockPaystackChargeAuthorization = vi.fn();
  const mockFlutterwaveChargeToken = vi.fn();
  const mockSendEmail = vi.fn();

  return {
    mockPrisma,
    mockPaystackChargeAuthorization,
    mockFlutterwaveChargeToken,
    mockSendEmail,
  };
});

vi.mock('@/lib/prisma', () => ({
  prisma: mocks.mockPrisma,
}));

vi.mock('@/lib/providers/paystack', () => ({
  paystackChargeAuthorization: (...args: any[]) => mocks.mockPaystackChargeAuthorization(...args),
}));

vi.mock('@/lib/providers/flutterwave', () => ({
  flutterwaveChargeToken: (...args: any[]) => mocks.mockFlutterwaveChargeToken(...args),
}));

vi.mock('@/lib/email', () => ({
  sendEmail: (...args: any[]) => mocks.mockSendEmail(...args),
}));

// Import GET after mocking dependencies
import { GET } from '@/app/api/cron/renew/route';

describe('Subscription Auto-Renewal Locking & Idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test_cron_secret';
    process.env.RENEWAL_LOCK_TIMEOUT_SECONDS = '900'; // 15 mins
    process.env.APP_URL = 'http://localhost:3000';
  });

  function makeRequest(secret = 'test_cron_secret') {
    return new NextRequest('http://localhost:3000/api/cron/renew', {
      headers: {
        authorization: `Bearer ${secret}`,
      },
    });
  }

  it('rejects unauthorized cron requests', async () => {
    const res = await GET(makeRequest('wrong_secret'));
    expect(res.status).toBe(401);
  });

  it('atomically claims subscription before calling payment provider', async () => {
    const subEnd = new Date(Date.now() + 2 * 60 * 60 * 1000); // 2 hours from now
    const periodTimestamp = Math.floor(subEnd.getTime() / 1000);

    const sub = {
      id: 'sub-123',
      userId: 'user-1',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt: subEnd,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_TEST_123',
      renewalAttempts: 0,
      renewalStatus: 'idle',
      renewalLockedAt: null,
      plan: { id: 'plan-1', name: 'Pro Plan', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-1', email: 'user@example.com', country: 'NG' },
    };

    mocks.mockPrisma.subscription.findMany.mockResolvedValueOnce([sub]);
    // Atomic lock succeeds
    mocks.mockPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.mockPaystackChargeAuthorization.mockResolvedValueOnce({
      success: true,
      raw: { id: 'charge_1', status: 'success' },
    });
    mocks.mockPrisma.transaction.create.mockResolvedValueOnce({ id: 'tx-1' });
    mocks.mockPrisma.subscription.update.mockResolvedValueOnce({ id: sub.id });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.renewed).toBe(1);
    expect(mocks.mockPrisma.subscription.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'sub-123',
        status: 'active',
        autoRenew: true,
        OR: [
          { renewalStatus: 'idle' },
          { renewalStatus: 'failed' },
          { renewalStatus: 'processing', renewalLockedAt: { lte: expect.any(Date) } },
        ],
      },
      data: {
        renewalStatus: 'processing',
        renewalLockedAt: expect.any(Date),
        renewalReference: `renew_sub-123_${periodTimestamp}_0`,
      },
    });

    // Verify charge used the deterministic reference
    expect(mocks.mockPaystackChargeAuthorization).toHaveBeenCalledWith({
      email: 'user@example.com',
      amountMinorUnits: 500000,
      currency: 'NGN',
      authorizationCode: 'AUTH_TEST_123',
      reference: `renew_sub-123_${periodTimestamp}_0`,
    });
  });

  it('skips charging if another simultaneous cron process acquired the atomic lock (race condition prevention)', async () => {
    const subEnd = new Date(Date.now() + 2 * 60 * 60 * 1000);
    const sub = {
      id: 'sub-concurrent',
      userId: 'user-2',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt: subEnd,
      renewalProvider: 'flutterwave',
      renewalAuthCode: 'FLW_TOKEN_999',
      renewalAttempts: 0,
      renewalStatus: 'idle',
      renewalLockedAt: null,
      plan: { id: 'plan-1', name: 'Pro Plan', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-2', email: 'concurrent@example.com', country: 'NG' },
    };

    mocks.mockPrisma.subscription.findMany.mockResolvedValueOnce([sub]);
    // updateMany count: 0 signifies another runner already claimed this subscription
    mocks.mockPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 0 });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.renewed).toBe(0);
    // CRITICAL: Ensure payment provider charge was NOT called
    expect(mocks.mockFlutterwaveChargeToken).not.toHaveBeenCalled();
    expect(mocks.mockPaystackChargeAuthorization).not.toHaveBeenCalled();
  });

  it('reclaims stuck processing renewal when lease timeout has expired', async () => {
    const subEnd = new Date(Date.now() + 1 * 60 * 60 * 1000);
    const periodTimestamp = Math.floor(subEnd.getTime() / 1000);
    const expiredLockTime = new Date(Date.now() - 30 * 60 * 1000); // locked 30 mins ago (lease is 15 mins)

    const sub = {
      id: 'sub-stuck',
      userId: 'user-3',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt: subEnd,
      renewalProvider: 'flutterwave',
      renewalAuthCode: 'FLW_TOKEN_333',
      renewalAttempts: 1,
      renewalStatus: 'processing',
      renewalLockedAt: expiredLockTime,
      plan: { id: 'plan-1', name: 'Pro Plan', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-3', email: 'stuck@example.com', country: 'NG' },
    };

    mocks.mockPrisma.subscription.findMany.mockResolvedValueOnce([sub]);
    mocks.mockPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.mockFlutterwaveChargeToken.mockResolvedValueOnce({
      success: true,
      raw: { id: 'flw_charge_1', status: 'successful' },
    });
    mocks.mockPrisma.transaction.create.mockResolvedValueOnce({ id: 'tx-flw-1' });
    mocks.mockPrisma.subscription.update.mockResolvedValueOnce({ id: sub.id });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.renewed).toBe(1);
    expect(mocks.mockFlutterwaveChargeToken).toHaveBeenCalledWith({
      token: 'FLW_TOKEN_333',
      amount: 5000,
      currency: 'NGN',
      email: 'stuck@example.com',
      txRef: `renew_sub-stuck_${periodTimestamp}_1`,
    });
  });

  it('handles provider charge failure and transitions renewalStatus to failed', async () => {
    const subEnd = new Date(Date.now() + 1 * 60 * 60 * 1000);
    const sub = {
      id: 'sub-fail',
      userId: 'user-4',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt: subEnd,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_DECLINE',
      renewalAttempts: 0,
      renewalStatus: 'idle',
      renewalLockedAt: null,
      plan: { id: 'plan-1', name: 'Pro Plan', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-4', email: 'fail@example.com', country: 'NG' },
    };

    mocks.mockPrisma.subscription.findMany.mockResolvedValueOnce([sub]);
    mocks.mockPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.mockPaystackChargeAuthorization.mockResolvedValueOnce({
      success: false,
      raw: { message: 'Insufficient funds' },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.retriesScheduled).toBe(1);
    expect(mocks.mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-fail' },
      data: {
        renewalStatus: 'failed',
        renewalLockedAt: null,
        renewalAttempts: 1,
        lastRenewalError: 'Charge declined by provider',
      },
    });
  });

  it('marks subscription as expired after reaching maximum renewal attempts', async () => {
    const subEnd = new Date(Date.now() + 1 * 60 * 60 * 1000);
    const sub = {
      id: 'sub-max-attempts',
      userId: 'user-5',
      planId: 'plan-1',
      status: 'active',
      autoRenew: true,
      endAt: subEnd,
      renewalProvider: 'paystack',
      renewalAuthCode: 'AUTH_EXHAUSTED',
      renewalAttempts: 2, // Next failure reaches MAX_RENEWAL_ATTEMPTS = 3
      renewalStatus: 'idle',
      renewalLockedAt: null,
      plan: { id: 'plan-1', name: 'Pro Plan', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null },
      user: { id: 'user-5', email: 'exhausted@example.com', country: 'NG' },
    };

    mocks.mockPrisma.subscription.findMany.mockResolvedValueOnce([sub]);
    mocks.mockPrisma.subscription.updateMany.mockResolvedValueOnce({ count: 1 });
    mocks.mockPaystackChargeAuthorization.mockResolvedValueOnce({
      success: false,
      raw: { message: 'Card expired' },
    });

    const res = await GET(makeRequest());
    const data = await res.json();

    expect(data.expired).toBe(1);
    expect(mocks.mockPrisma.subscription.update).toHaveBeenCalledWith({
      where: { id: 'sub-max-attempts' },
      data: {
        status: 'expired',
        autoRenew: false,
        renewalStatus: 'failed',
        renewalLockedAt: null,
        renewalAttempts: 3,
        lastRenewalError: 'Charge declined by provider',
      },
    });
  });
});
