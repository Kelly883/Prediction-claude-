import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  emailVerificationToken: { create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockSendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/lib/email', () => ({ sendAdminVerificationEmail: mockSendEmail }));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/rbac', async () => {
  const actual = await vi.importActual<any>('@/lib/rbac');
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin', permissions: [] }),
    hasPermission: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@/lib/csrf', () => ({
  requireSameOrigin: vi.fn(),
  requireCsrf: vi.fn(),
}));

function makeRequest() {
  return new NextRequest('http://localhost:3000/api/admin/users/user-1/resend-verification', { method: 'POST' });
}

describe('POST /api/admin/users/[id]/resend-verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.emailVerificationToken.create.mockResolvedValue({ id: 'tok-1' });
    mockSendEmail.mockResolvedValue(undefined);
  });

  it('sends a verification email for an unverified user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'unverified@example.com', emailVerifiedAt: null, deletedAt: null,
    });

    const { POST } = await import('@/app/api/admin/users/[id]/resend-verification/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'user-1' }) });

    expect(res.status).toBe(200);
    expect(mockSendEmail).toHaveBeenCalledTimes(1);
  });

  it('rejects with a clear error for an already-verified user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'verified@example.com', emailVerifiedAt: new Date(), deletedAt: null,
    });

    const { POST } = await import('@/app/api/admin/users/[id]/resend-verification/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'user-1' }) });
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(body.error).toMatch(/already verified/i);
  });

  it('returns 404 for a nonexistent user rather than silently no-oping', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    const { POST } = await import('@/app/api/admin/users/[id]/resend-verification/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'nonexistent' }) });

    expect(res.status).toBe(404);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('surfaces the actual email failure to the admin, unlike the public endpoint', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', email: 'unverified@example.com', emailVerifiedAt: null, deletedAt: null,
    });
    mockSendEmail.mockRejectedValue(new Error('Resend not configured'));

    const { POST } = await import('@/app/api/admin/users/[id]/resend-verification/route');
    const res = await POST(makeRequest(), { params: Promise.resolve({ id: 'user-1' }) });
    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toMatch(/RESEND_API_KEY/);
  });
});
