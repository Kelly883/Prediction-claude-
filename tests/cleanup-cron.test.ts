import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  passwordResetToken: { deleteMany: vi.fn() },
  emailVerificationToken: { deleteMany: vi.fn() },
  userSession: { deleteMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { GET as cleanupGet } from '@/app/api/cron/cleanup/route';

describe('cleanup cron', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CRON_SECRET = 'test-cron-secret';
  });

  it('returns 401 without cron secret', async () => {
    const req = new Request('http://localhost/api/cron/cleanup');
    const res = await cleanupGet(req as any);
    expect(res.status).toBe(401);
  });

  it('deletes old password reset tokens and sessions', async () => {
    mockPrisma.passwordResetToken.deleteMany.mockResolvedValue({ count: 42 });
    mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 3 });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 7 });

    const req = new Request('http://localhost/api/cron/cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    const res = await cleanupGet(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.passwordResetTokensDeleted).toBe(42);
    expect(json.emailVerificationTokensDeleted).toBe(3);
    expect(json.sessionsDeleted).toBe(7);
  });

  it('reports errors without crashing', async () => {
    mockPrisma.passwordResetToken.deleteMany.mockRejectedValue(new Error('db error'));
    mockPrisma.emailVerificationToken.deleteMany.mockResolvedValue({ count: 2 });
    mockPrisma.userSession.deleteMany.mockResolvedValue({ count: 1 });

    const req = new Request('http://localhost/api/cron/cleanup', {
      headers: { authorization: 'Bearer test-cron-secret' },
    });
    const res = await cleanupGet(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.errors.length).toBeGreaterThanOrEqual(1);
    expect(json.emailVerificationTokensDeleted).toBe(2);
    expect(json.sessionsDeleted).toBe(1);
  });
});
