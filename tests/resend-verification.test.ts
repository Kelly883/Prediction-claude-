import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  emailVerificationToken: {
    create: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 0 }),
  },
  $transaction: vi.fn(async (fn: any) => fn(mockPrisma)),
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email', () => ({ sendVerificationEmail: mockSendEmail }));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  authLimiter: {},
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
  normalizeIdentifier: (_type: string, v: string) => v.toLowerCase(),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

function makeRequest(body: any) {
  return new NextRequest('http://localhost:3000/api/auth/resend-verification', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.emailVerificationToken.create.mockResolvedValue({ id: 'tok-1' });
    mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
    mockSendEmail.mockResolvedValue(undefined);
  });

  it('sends a new verification email for an existing, unverified account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'unverified@example.com', emailVerifiedAt: null, deletedAt: null,
    });

    const { POST } = await import('@/app/api/auth/resend-verification/route');
    const res = await POST(makeRequest({ email: 'unverified@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.emailVerificationToken.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.emailVerificationToken.create).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('unverified@example.com');
    expect(body.emailSent).toBe(true);
  });

  it('normalizes the email before lookup', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'unverified@example.com', emailVerifiedAt: null, deletedAt: null,
    });

    const { POST } = await import('@/app/api/auth/resend-verification/route');
    const res = await POST(makeRequest({ email: '  Unverified@Example.COM  ' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'unverified@example.com' } });
    expect(body.emailSent).toBe(true);
  });

  it('returns emailSent false for an already-verified account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-2', email: 'verified@example.com', emailVerifiedAt: new Date(), deletedAt: null,
    });

    const { POST } = await import('@/app/api/auth/resend-verification/route');
    const res = await POST(makeRequest({ email: 'verified@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.emailSent).toBe(false);
  });

  it('returns emailSent false for a nonexistent account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/auth/resend-verification/route');
    const res = await POST(makeRequest({ email: 'nobody@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.emailSent).toBe(false);
  });

  it('does not send an email for a soft-deleted account', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-3', email: 'deleted@example.com', emailVerifiedAt: null, deletedAt: new Date(),
    });

    const { POST } = await import('@/app/api/auth/resend-verification/route');
    const res = await POST(makeRequest({ email: 'deleted@example.com' }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.emailSent).toBe(false);
  });
});
