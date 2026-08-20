import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  auditLog: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/rbac', async () => {
  const actual = await vi.importActual<any>('@/lib/rbac');
  return {
    ...actual,
    requireAdmin: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin' }),
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
    // The bug this covers: the frontend's fetch wrapper (apiJson) only ever
    // returns the parsed body and silently discards response headers, so a
    // total count sent ONLY via X-Total was never actually reachable by any
    // caller — pagination looked fine in the API but was permanently stuck
    // on page 1 in the UI. This test would have caught that regression.
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
    // The other bug this covers: the Action filter dropdown used to be
    // built from `logs` (the current page only) client-side, so an action
    // that only occurred on page 3 was literally unselectable while
    // viewing page 1. availableActions must come from an unfiltered,
    // distinct query, independent of `where`.
    mockPrisma.auditLog.findMany
      .mockResolvedValueOnce([{ id: 'log-1', action: 'user.export', actor: { email: 'admin@x.com' } }])
      .mockResolvedValueOnce([
        { action: 'admin.email_verification_resent' },
        { action: 'plan.update' },
        { action: 'user.export' },
      ]);
    mockPrisma.auditLog.count.mockResolvedValue(1);

    const { GET } = await import('@/app/api/admin/audit-logs/route');
    // Filtered down to a single action for the actual page of results...
    const res = await GET(makeRequest('?action=user.export'));
    const body = await res.json();

    // ...but the dropdown's action list should still include actions that
    // aren't present in this filtered/paginated result set at all.
    expect(body.availableActions).toEqual(
      expect.arrayContaining(['admin.email_verification_resent', 'plan.update', 'user.export']),
    );
  });

  it('rejects non-admin callers', async () => {
    const { requireAdmin } = await import('@/lib/rbac');
    const { ApiError } = await import('@/lib/rbac');
    (requireAdmin as any).mockRejectedValueOnce(new ApiError(403, 'Forbidden'));

    const { GET } = await import('@/app/api/admin/audit-logs/route');
    const res = await GET(makeRequest());

    expect(res.status).toBe(403);
  });
});
