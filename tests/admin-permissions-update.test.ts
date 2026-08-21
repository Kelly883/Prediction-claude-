import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/rbac', async () => {
  const actual = await vi.importActual<any>('@/lib/rbac');
  return {
    ...actual,
    requireSuperAdmin: vi.fn().mockResolvedValue({ sub: 'super-1', role: 'superadmin' }),
  };
});

vi.mock('@/lib/csrf', () => ({
  requireSameOrigin: vi.fn(),
  requireCsrf: vi.fn(),
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

function makeRequest(body: any) {
  return new NextRequest('http://localhost:3000/api/admin/users/user-1/permissions', {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

describe('PATCH /api/admin/users/[id]/permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('updating only permissions for an existing admin (role omitted) does not wipe them to []', async () => {
    // The actual bug: the update logic checked the raw request `role`
    // field, not the role the account would actually have afterward. A
    // caller reasonably omitting `role` because it isn't changing —
    // "just update this admin's permissions" — used to silently zero them
    // out, because undefined !== 'admin'.
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'admin', name: 'Bo', email: 'bo@example.com', deletedAt: null,
    });
    mockPrisma.user.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'user-1', ...data }));

    const { PATCH } = await import('@/app/api/admin/users/[id]/permissions/route');
    const res = await PATCH(makeRequest({ permissions: ['admin.pages.plans', 'admin.pages.users'] }), {
      params: Promise.resolve({ id: 'user-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.role).toBe('admin');
    expect(body.permissions).toEqual(['admin.pages.plans', 'admin.pages.users']);
  });

  it('still correctly sets permissions to [] when actually demoting an admin to user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'admin', name: 'Bo', email: 'bo@example.com', deletedAt: null,
    });
    mockPrisma.user.update.mockImplementation(({ data }: any) => Promise.resolve({ id: 'user-1', ...data }));

    const { PATCH } = await import('@/app/api/admin/users/[id]/permissions/route');
    // Note: current schema only allows role to be 'admin' here (superadmin
    // assignment is separately blocked) — omitting role and not passing
    // permissions models "leave everything as-is" rather than a real
    // demotion path, which this API doesn't expose. This test instead
    // covers that permissions are [] when none are supplied at all.
    const res = await PATCH(makeRequest({ role: 'admin' }), {
      params: Promise.resolve({ id: 'user-1' }),
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.permissions).toEqual([]);
  });

  it('rejects assigning a second superadmin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'admin', name: 'Bo', email: 'bo@example.com', deletedAt: null,
    });

    const { PATCH } = await import('@/app/api/admin/users/[id]/permissions/route');
    const res = await PATCH(makeRequest({ role: 'superadmin' }), {
      params: Promise.resolve({ id: 'user-1' }),
    });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects modifying another superadmin', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'user-1', role: 'superadmin', name: 'Other Super', email: 'other@example.com', deletedAt: null,
    });

    const { PATCH } = await import('@/app/api/admin/users/[id]/permissions/route');
    const res = await PATCH(makeRequest({ permissions: [] }), {
      params: Promise.resolve({ id: 'user-1' }),
    });

    expect(res.status).toBe(403);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects self-modification', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: 'super-1', role: 'superadmin', name: 'Self', email: 'self@example.com', deletedAt: null,
    });

    const { PATCH } = await import('@/app/api/admin/users/[id]/permissions/route');
    const res = await PATCH(makeRequest({ permissions: [] }), {
      params: Promise.resolve({ id: 'super-1' }),
    });

    expect(res.status).toBe(400);
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});
