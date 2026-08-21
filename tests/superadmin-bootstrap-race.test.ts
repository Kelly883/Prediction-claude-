import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { count: vi.fn(), create: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

const mockRedis = vi.hoisted(() => ({
  set: vi.fn(),
  get: vi.fn(),
  del: vi.fn(),
}));
vi.mock('@/lib/redis', () => ({ redis: mockRedis }));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  bootstrapLimiter: {},
  getClientIp: vi.fn().mockReturnValue('127.0.0.1'),
}));

vi.mock('@/lib/csrf', () => ({
  requireSameOrigin: vi.fn(),
  requireCsrf: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/twofactor', () => ({
  verifyTotpCode: vi.fn().mockReturnValue(true),
}));

function makeRequest(id: string, code = '123456') {
  return new NextRequest(`http://localhost:3000/api/superadmin/setup/verify?id=${id}`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

describe('POST /api/superadmin/setup/verify — TOCTOU race protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.user.count.mockResolvedValue(0); // hasSuperAdmin() -> false
    mockRedis.get.mockResolvedValue(JSON.stringify({
      name: 'Ada', email: 'ada@example.com', passwordHash: 'hash', encryptedSecret: 'v1:enc',
    }));
    mockRedis.del.mockResolvedValue(1);
  });

  it('creates the superadmin when the lock is acquired successfully', async () => {
    mockRedis.set.mockResolvedValue('OK'); // lock acquired
    mockPrisma.user.create.mockResolvedValue({
      id: 'user-1', name: 'Ada', email: 'ada@example.com', role: 'superadmin', twoFactorEnabled: true, createdAt: new Date(),
    });

    const { POST } = await import('@/app/api/superadmin/setup/verify/route');
    const res = await POST(makeRequest('session-1'));

    expect(res.status).toBe(200);
    expect(mockPrisma.user.create).toHaveBeenCalledTimes(1);
    // Lock must be attempted with nx (only-set-if-absent) — that's the
    // actual mechanism that makes this safe under concurrency.
    expect(mockRedis.set).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(String),
      expect.objectContaining({ nx: true }),
    );
    // And released afterward, so a legitimate retry isn't blocked forever
    // by a stray lock.
    expect(mockRedis.del).toHaveBeenCalled();
  });

  it('refuses to create a second superadmin when the lock is already held by a concurrent request', async () => {
    // This is the actual race this fix closes: two bootstrap completions
    // submitted close together. Simulated here by the lock acquisition
    // itself failing (as it would for the second of two concurrent
    // requests against real Redis's SET NX).
    mockRedis.set.mockResolvedValue(null); // lock NOT acquired — someone else holds it

    const { POST } = await import('@/app/api/superadmin/setup/verify/route');
    const res = await POST(makeRequest('session-1'));
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error).toMatch(/already being created/i);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('does not attempt to create a superadmin, or ever touch the lock, on an invalid 2FA code', async () => {
    const { verifyTotpCode } = await import('@/lib/twofactor');
    (verifyTotpCode as any).mockReturnValueOnce(false);

    const { POST } = await import('@/app/api/superadmin/setup/verify/route');
    const res = await POST(makeRequest('session-1'));

    expect(res.status).toBe(400);
    expect(mockRedis.set).not.toHaveBeenCalled();
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
  });

  it('releases the lock even if user creation throws, so a real failure does not permanently block retries', async () => {
    mockRedis.set.mockResolvedValue('OK');
    mockPrisma.user.create.mockRejectedValue(new Error('DB connection lost'));

    const { POST } = await import('@/app/api/superadmin/setup/verify/route');
    await POST(makeRequest('session-1'));

    expect(mockRedis.del).toHaveBeenCalled();
  });
});
