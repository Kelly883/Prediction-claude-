import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn().mockResolvedValue({ id: 'admin-1', role: 'admin', deletedAt: null }) },
  auditLog: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/rbac', async () => {
  const actual = await vi.importActual<any>('@/lib/rbac');
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin', permissions: [] }),
  };
});

function makeRequest(query: string = '') {
  return new NextRequest(`http://localhost:3000/api/admin/audit-logs${query}`);
}

describe('GET /api/admin/audit-logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns total in the JSON body, not only as a header', async () => {
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce([{ id: 'log-1', action: 'plan.update', actor: { email: 'admin@x.com' } }])
      .mockResolvedValueOnce([{ action: 'plan.update' }, { action: 'user.export' }]);
    mockPrisma.auditLog.count.mockResolvedValue(37);

    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const res = await GET(makeRequest('?page=1&pageSize=20'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.total).toBe(37);
    expect(body.totalPages).toBe(Math.ceil(37 / 20));
    expect(Array.isArray(body.logs)).toBe(true);
    expect(body.logs).toHaveLength(1);
  });

  it('availableActions reflects the whole table, not just the current filtered/paginated page', async () => {
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce([{ id: 'log-1', action: 'user.export', actor: { email: 'admin@x.com' } }])
      .mockResolvedValueOnce([
        { action: 'admin.email_verification_resent' },
        { action: 'plan.update' },
        { action: 'user.export' },
      ]);
    mockPrisma.auditLog.count.mockResolvedValue(1);

    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const res = await GET(makeRequest('?action=user.export'));
    const body = await res.json();

    expect(body.availableActions).toEqual(
      expect.arrayContaining(['admin.email_verification_resent', 'plan.update', 'user.export']),
    );
  });

  it('rejects non-admin callers', async () => {
    const { requirePermission } = await import('@/lib/rbac');
    const { ApiError } = await import('@/lib/rbac');
    (requirePermission as any).mockRejectedValueOnce(new ApiError(403, 'Forbidden'));

    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });
});
