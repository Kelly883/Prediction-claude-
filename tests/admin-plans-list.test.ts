import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  plan: { findMany: vi.fn() },
}));

const mockRbac = vi.hoisted(() => ({
  requireAdmin: vi.fn(),
  errorResponse: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rbac', () => mockRbac);

import { GET } from '@/app/api/admin/plans/list/route';

describe('GET /api/admin/plans/list', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRbac.requireAdmin.mockResolvedValue({ sub: 'admin-1', role: 'admin' });
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
  });

  it('returns 401 when not authenticated', async () => {
    mockRbac.requireAdmin.mockRejectedValue(new mockRbac.ApiError(401, 'Missing session'));
    const req = new Request('http://localhost/api/admin/plans/list');
    const res = await GET(req as any);
    expect(res.status).toBe(401);
  });

  it('returns 403 when user is not admin', async () => {
    mockRbac.requireAdmin.mockRejectedValue(new mockRbac.ApiError(403, 'Insufficient permissions'));
    const req = new Request('http://localhost/api/admin/plans/list');
    const res = await GET(req as any);
    expect(res.status).toBe(403);
  });

  it('returns only plans created by the authenticated admin', async () => {
    const plans = [
      { id: '1', name: 'VIP Daily', createdById: 'admin-1' },
      { id: '2', name: 'Weekend Bank', createdById: 'admin-1' },
    ];
    mockPrisma.plan.findMany.mockResolvedValue(plans);

    const req = new Request('http://localhost/api/admin/plans/list');
    const res = await GET(req as any);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toHaveLength(2);
    expect(mockPrisma.plan.findMany).toHaveBeenCalledWith({
      where: { createdById: 'admin-1' },
      orderBy: { createdAt: 'desc' },
    });
  });
});
