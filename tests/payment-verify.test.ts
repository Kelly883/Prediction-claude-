import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  transaction: { findUnique: vi.fn(), update: vi.fn() },
  user: { findUnique: vi.fn() },
  plan: { findUnique: vi.fn() },
  subscription: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

const mockRbac = vi.hoisted(() => ({
  requireUser: vi.fn(),
  errorResponse: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

const mockPayments = vi.hoisted(() => ({
  handleVerifiedWebhook: vi.fn(),
}));

const mockPaystack = vi.hoisted(() => ({
  paystackVerifyTransaction: vi.fn(),
}));

const mockFlutterwave = vi.hoisted(() => ({
  flutterwaveVerifyTransaction: vi.fn(),
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rbac', () => mockRbac);
vi.mock('@/lib/payments', () => mockPayments);
vi.mock('@/lib/providers/paystack', () => mockPaystack);
vi.mock('@/lib/providers/flutterwave', () => mockFlutterwave);
vi.mock('@/lib/audit', () => mockAudit);

import { POST as verifyPost } from '@/app/api/payments/verify/route';

function makeReq(body: any, authSub = 'user-1'): NextRequest {
  return new NextRequest('http://localhost/api/payments/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: `access_token=fake-token-${authSub}` },
    body: JSON.stringify(body),
  });
}

describe('POST /api/payments/verify', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
    mockPayments.handleVerifiedWebhook.mockResolvedValue({ id: 'tx-1', status: 'success' });
    mockAudit.writeAudit.mockResolvedValue(undefined);
  });

  it('returns 400 when reference is missing', async () => {
    const req = makeReq({ provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when provider is missing', async () => {
    const req = makeReq({ reference: 'ref-123' });
    const res = await verifyPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when transaction not found', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue(null);
    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(404);
  });

  it('returns 403 when transaction belongs to another user', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'other-user',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
    });
    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(403);
  });

  it('returns 400 for unsupported provider', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
      planId: 'plan-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });

    const req = makeReq({ reference: 'ref-123', provider: 'unknown' });
    const res = await verifyPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 200 with already-confirmed status when tx is already success', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'success',
      planId: 'plan-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });

    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('success');
    expect(json.message).toBe('Payment already confirmed');
  });

  it('verifies with paystack and activates subscription on success', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
      planId: 'plan-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null });
    mockPaystack.paystackVerifyTransaction.mockResolvedValue({
      verified: true,
      reference: 'ref-123',
      amount: 5000,
      currency: 'NGN',
      status: 'success',
      customerEmail: 'user@test.com',
    });

    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('success');
    expect(mockPayments.handleVerifiedWebhook).toHaveBeenCalledWith(
      expect.objectContaining({
        providerReference: 'ref-123',
        status: 'success',
        amountPaid: 5000,
        currencyPaid: 'NGN',
      })
    );
  });

  it('verifies with flutterwave and activates subscription on success', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'pp_abc123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
      planId: 'plan-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null });
    mockFlutterwave.flutterwaveVerifyTransaction.mockResolvedValue({
      verified: true,
      txRef: 'abc123',
      amount: 5000,
      currency: 'NGN',
      status: 'successful',
      customerEmail: 'user@test.com',
    });

    const req = makeReq({ reference: 'pp_abc123', provider: 'flutterwave' });
    const res = await verifyPost(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('success');
    expect(mockFlutterwave.flutterwaveVerifyTransaction).toHaveBeenCalledWith({ txRef: 'abc123' });
  });

  it('returns 400 when provider verification fails', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
      planId: 'plan-1',
    });
    mockPaystack.paystackVerifyTransaction.mockResolvedValue({
      verified: false,
      reference: 'ref-123',
      amount: 0,
      currency: '',
      status: 'failed',
    });

    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Payment verification failed with provider');
  });

  it('returns 400 when amount/currency/email mismatch', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 5000,
      currency: 'NGN',
      status: 'pending',
      planId: 'plan-1',
    });
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', email: 'user@test.com' });
    mockPrisma.plan.findUnique.mockResolvedValue({ id: 'plan-1', durationDays: 30, priceNGN: 5000, priceUSDOverride: null, fxMarkupPercent: null });
    mockPaystack.paystackVerifyTransaction.mockResolvedValue({
      verified: true,
      reference: 'ref-123',
      amount: 10000,
      currency: 'USD',
      status: 'success',
      customerEmail: 'hacker@evil.com',
    });

    const req = makeReq({ reference: 'ref-123', provider: 'paystack' });
    const res = await verifyPost(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Transaction verification mismatch (amount, currency, or customer)');
  });
});
