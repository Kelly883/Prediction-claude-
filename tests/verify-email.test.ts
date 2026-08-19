import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  emailVerificationToken: { findUnique: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => true),
  authLimiter: {},
  getClientIp: () => '127.0.0.1',
}));

function makeRequest(body: any) {
  return new NextRequest('http://localhost:3000/api/auth/verify-email', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/verify-email', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  });

  it('returns email for expired tokens so the frontend can preseed the resend form', async () => {
    const now = new Date();
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      tokenHash: 'hash',
      usedAt: null,
      expiresAt: new Date(now.getTime() - 1000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'expired@example.com',
      deletedAt: null,
    });

    const { POST } = await import('@/app/api/auth/verify-email/route');
    const res = await POST(makeRequest({ token: 'expired-token' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.reason).toBe('expired');
    expect(body.email).toBe('expired@example.com');
  });

  it('returns email for used tokens so the frontend can preseed the resend form', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      tokenHash: 'hash',
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'used@example.com',
      deletedAt: null,
    });

    const { POST } = await import('@/app/api/auth/verify-email/route');
    const res = await POST(makeRequest({ token: 'used-token' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.reason).toBe('already_used');
    expect(body.email).toBe('used@example.com');
  });

  it('returns no email for truly unknown tokens', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/auth/verify-email/route');
    const res = await POST(makeRequest({ token: 'unknown-token' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.reason).toBe('token_not_found');
    expect(body.email).toBeNull();
  });

  it('returns account_deleted for a token tied to a soft-deleted account', async () => {
    mockPrisma.emailVerificationToken.findUnique.mockResolvedValue({
      id: 'tok-1',
      userId: 'user-1',
      tokenHash: 'hash',
      usedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    });
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      email: 'deleted@example.com',
      deletedAt: new Date(),
    });

    const { POST } = await import('@/app/api/auth/verify-email/route');
    const res = await POST(makeRequest({ token: 'token' }));
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.reason).toBe('account_deleted');
    expect(body.email).toBe('deleted@example.com');
  });
});
