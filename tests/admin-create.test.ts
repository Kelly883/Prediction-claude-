import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn() },
}));

const mockRbac = vi.hoisted(() => ({
  requireSuperAdmin: vi.fn(),
  errorResponse: vi.fn(),
  ApiError: class ApiError extends Error {
    constructor(public status: number, message: string) {
      super(message);
    }
  },
}));

const mockAudit = vi.hoisted(() => ({
  writeAudit: vi.fn(),
}));

const mockRateLimit = vi.hoisted(() => ({
  checkRateLimit: vi.fn(),
  adminLimiter: {},
  getClientIp: vi.fn(() => '127.0.0.1'),
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));
vi.mock('@/lib/rbac', () => mockRbac);
vi.mock('@/lib/audit', () => mockAudit);
vi.mock('@/lib/ratelimit', () => mockRateLimit);

import { POST as createAdminPost } from '@/app/api/admin/admins/route';

function makeReq(body: any): NextRequest {
  return new NextRequest('http://localhost/api/admin/admins', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', cookie: 'access_token=fake-token-superadmin' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/admin/admins', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRbac.requireSuperAdmin.mockResolvedValue({ sub: 'super-1', role: 'superadmin' });
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
    mockAudit.writeAudit.mockResolvedValue(undefined);
    mockRateLimit.checkRateLimit.mockResolvedValue(true);
  });

  it('returns 400 when name is missing', async () => {
    const req = makeReq({ email: 'admin@test.com' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 400 when email is missing', async () => {
    const req = makeReq({ name: 'Test Admin' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(400);
  });

  it('returns 409 when email already exists', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'existing', email: 'admin@test.com' });
    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(409);
  });

  it('creates admin with default permissions when none provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: [],
    });

    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.role).toBe('admin');
    expect(json.permissions).toEqual([]);
    expect(mockPrisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          role: 'admin',
          permissions: [],
        }),
      })
    );
  });

  it('creates admin with provided permissions', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: ['pages.users', 'admin.createAdmins'],
    });

    const req = makeReq({
      name: 'Test Admin',
      email: 'admin@test.com',
      permissions: ['pages.users', 'admin.createAdmins'],
    });
    const res = await createAdminPost(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.permissions).toEqual(['pages.users', 'admin.createAdmins']);
  });

  it('generates random password when none provided', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: [],
    });

    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(201);
    const createCall = (mockPrisma.user.create as any).mock.calls[0][0];
    expect(createCall.data.passwordHash).toBeDefined();
    expect(typeof createCall.data.passwordHash).toBe('string');
    expect(createCall.data.passwordHash.length).toBeGreaterThan(0);
  });

  it('uses provided password when given', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: [],
    });

    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com', password: 'my-secret-password' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(201);
  });

  it('audits admin creation', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: [],
    });

    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com' });
    await createAdminPost(req);
    expect(mockAudit.writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'admin.create',
        targetId: 'admin-1',
        metadata: expect.objectContaining({
          email: 'admin@test.com',
          role: 'admin',
        }),
      })
    );
  });

  it('ignores role field and always creates admin role', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockResolvedValue({
      id: 'admin-1',
      name: 'Test Admin',
      email: 'admin@test.com',
      role: 'admin',
      permissions: [],
    });

    const req = makeReq({ name: 'Test Admin', email: 'admin@test.com', role: 'superadmin' });
    const res = await createAdminPost(req);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.role).toBe('admin');
  });
});
