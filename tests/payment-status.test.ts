import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  transaction: { findUnique: vi.fn() },
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

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rbac', () => mockRbac);

import { GET as statusGet } from '@/app/api/payments/status/route';

function makeReq(url: string): any {
  return {
    url,
    nextUrl: new URL(url),
  };
}

describe('payments status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
  });

  it('returns 400 when reference is missing', async () => {
    const req = makeReq('http://localhost/api/payments/status');
    const res = await statusGet(req);
    expect(res.status).toBe(400);
  });

  it('returns 404 when transaction not found', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue(null);

    const req = makeReq('http://localhost/api/payments/status?reference=ref-123');
    const res = await statusGet(req);
    expect(res.status).toBe(404);
  });

  it('returns 404 when transaction belongs to another user', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'other-user',
      amount: 1000,
      currency: 'NGN',
      status: 'success',
    });

    const req = makeReq('http://localhost/api/payments/status?reference=ref-123');
    const res = await statusGet(req);
    expect(res.status).toBe(404);
  });

  it('returns status when transaction belongs to caller', async () => {
    mockPrisma.transaction.findUnique.mockResolvedValue({
      id: 'tx-1',
      providerReference: 'ref-123',
      userId: 'user-1',
      amount: 1000,
      currency: 'NGN',
      status: 'success',
    });

    const req = makeReq('http://localhost/api/payments/status?reference=ref-123');
    const res = await statusGet(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('success');
    expect(json.amount).toBe('1000');
    expect(json.currency).toBe('NGN');
  });
});
