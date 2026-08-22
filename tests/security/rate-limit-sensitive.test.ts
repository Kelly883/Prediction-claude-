import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRbac = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requirePermission: vi.fn(),
  requireSuperAdmin: vi.fn(),
  errorResponse: vi.fn(),
}));

vi.mock('@/lib/rbac', () => mockRbac);

const mockRateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  authLimiter: {},
  adminLimiter: {},
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/ratelimit', () => mockRateLimit);

describe('P1-06 Sensitive Workflow Rate Limits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
  });

  describe('Password change rate limiting', () => {
    it('enforces rate limit on password change', async () => {
      mockRateLimit.checkRateLimit.mockResolvedValue(false);
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });

      const { PATCH } = await import('@/app/api/me/password/route');
      const req = new NextRequest('http://localhost:3000/api/me/password', { method: 'PATCH' });
      req.headers.set('Content-Type', 'application/json');
      req.headers.set('x-csrf-token', 'test');

      const res = await PATCH(req);
      expect(res.status).toBe(429);
      expect(mockRateLimit.checkRateLimit).toHaveBeenCalledWith(mockRateLimit.authLimiter, expect.arrayContaining(['127.0.0.1', 'user:user-1']));
    });
  });

  describe('Admin user actions rate limiting', () => {
    it('enforces rate limit on admin user unlock/restore', async () => {
      mockRateLimit.checkRateLimit.mockResolvedValue(false);
      mockRbac.requirePermission.mockResolvedValue({ sub: 'admin-1', role: 'admin' });

      const { PATCH } = await import('@/app/api/admin/users/[id]/route');
      const req = new NextRequest('http://localhost:3000/api/admin/users/user-1', { method: 'PATCH' });
      req.headers.set('Content-Type', 'application/json');
      req.headers.set('x-csrf-token', 'test');

      const res = await PATCH(req, { params: Promise.resolve({ id: 'user-1' }) });
      expect(res.status).toBe(429);
      expect(mockRateLimit.checkRateLimit).toHaveBeenCalledWith(mockRateLimit.adminLimiter, expect.arrayContaining(['127.0.0.1', 'admin:admin-1']));
    });
  });

  describe('Admin creation rate limiting', () => {
    it('enforces rate limit on admin creation', async () => {
      mockRateLimit.checkRateLimit.mockResolvedValue(false);
      mockRbac.requireSuperAdmin.mockResolvedValue({ sub: 'superadmin-1', role: 'superadmin' });

      const { POST } = await import('@/app/api/admin/admins/route');
      const req = new NextRequest('http://localhost:3000/api/admin/admins', { method: 'POST' });
      req.headers.set('Content-Type', 'application/json');
      req.headers.set('x-csrf-token', 'test');

      const res = await POST(req);
      expect(res.status).toBe(429);
      expect(mockRateLimit.checkRateLimit).toHaveBeenCalledWith(mockRateLimit.adminLimiter, expect.arrayContaining(['127.0.0.1', 'superadmin:superadmin-1']));
    });
  });

  describe('Plan creation rate limiting', () => {
    it('enforces rate limit on plan creation', async () => {
      mockRateLimit.checkRateLimit.mockResolvedValue(false);
      mockRbac.requirePermission.mockResolvedValue({ sub: 'admin-1', role: 'admin' });

      const { POST } = await import('@/app/api/admin/plans/route');
      const req = new NextRequest('http://localhost:3000/api/admin/plans', { method: 'POST' });
      req.headers.set('Content-Type', 'application/json');
      req.headers.set('x-csrf-token', 'test');

      const res = await POST(req);
      expect(res.status).toBe(429);
      expect(mockRateLimit.checkRateLimit).toHaveBeenCalledWith(mockRateLimit.adminLimiter, expect.arrayContaining(['127.0.0.1', 'admin:admin-1']));
    });
  });
});
