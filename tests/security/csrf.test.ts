import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

function makeFakeDb() {
  const users = new Map<string, any>();
  const freeAccessRules = new Map<string, any>();
  const complimentaryAccess = new Map<string, any>();
  const predictionPosts = new Map<string, any>();

  const db: any = {
    user: {
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.id) return users.get(where.id) ?? null;
        return null;
      }),
      count: vi.fn(async () => 0),
      create: vi.fn(async ({ data }: any) => data),
    },
    freeAccessRule: {
      findMany: vi.fn(async () => []),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'rule-1', ...data })),
    },
    complimentaryAccess: {
      findMany: vi.fn(async () => []),
      delete: vi.fn(async ({ where }: any) => ({ id: where.id })),
      create: vi.fn(async ({ data }: any) => ({ id: 'grant-1', ...data })),
    },
    predictionPost: {
      findMany: vi.fn(async () => []),
      findUnique: vi.fn(async ({ where }: any) => predictionPosts.get(where.id) ?? null),
      update: vi.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      create: vi.fn(async ({ data }: any) => ({ id: 'post-1', ...data })),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seedUser(user: any) {
      users.set(user.id, { tokenVersion: 0, ...user });
    },
    _seedRule(rule: any) {
      freeAccessRules.set(rule.id, rule);
    },
    _seedComplimentary(grant: any) {
      complimentaryAccess.set(grant.id, grant);
    },
    _seedPost(post: any) {
      predictionPosts.set(post.id, post);
    },
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn(async () => true),
  authLimiter: {},
  adminLimiter: {},
  getClientIp: () => '127.0.0.1',
  normalizeIdentifier: (_type: string, v: string) => v,
}));

vi.mock('@/lib/audit', () => ({ writeAudit: vi.fn() }));

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    requireAdmin: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin' }),
    requireAdminWith2FA: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin' }),
  };
});

function crossOriginReq(url: string, init: RequestInit = {}): NextRequest {
  const mergedHeaders = new Headers(init.headers);
  mergedHeaders.set('origin', 'http://evil.com');
  mergedHeaders.set('host', 'localhost');
  return new NextRequest(url, {
    ...init,
    headers: mergedHeaders,
    signal: init.signal ?? undefined,
  });
}

describe('Security: CSRF', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('allows logout without authentication so expired sessions can clear cookies', async () => {
    const { POST } = await import('@/app/api/auth/logout/route');
    const req = new NextRequest('http://localhost/api/auth/logout', {
      method: 'POST',
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    const cookies = res.headers.get('set-cookie') ?? '';
    expect(cookies).toContain('access_token=;');
    expect(cookies).toContain('refresh_token=;');
  });

  it('requires CSRF for PATCH /api/admin/free-access-rules/:id', async () => {
    const { PATCH } = await import('@/app/api/admin/free-access-rules/[id]/route');
    const req = crossOriginReq('http://localhost/api/admin/free-access-rules/rule-1', {
      method: 'PATCH',
      body: JSON.stringify({ isActive: false }),
    });

    const res = await PATCH(req, { params: Promise.resolve({ id: 'rule-1' }) });
    expect(res.status).toBe(403);
  });

  it('requires CSRF for DELETE /api/admin/complimentary-access/:id', async () => {
    const { DELETE } = await import('@/app/api/admin/complimentary-access/[id]/route');
    const req = crossOriginReq('http://localhost/api/admin/complimentary-access/grant-1', {
      method: 'DELETE',
    });

    const res = await DELETE(req, { params: Promise.resolve({ id: 'grant-1' }) });
    expect(res.status).toBe(403);
  });

  it('requires CSRF for POST /api/admin/predictions/:id/publish', async () => {
    fakeDb._seedPost({ id: 'post-1', status: 'draft' });
    const { POST } = await import('@/app/api/admin/predictions/[id]/publish/route');
    const req = crossOriginReq('http://localhost/api/admin/predictions/post-1', {
      method: 'POST',
    });

    const res = await POST(req, { params: Promise.resolve({ id: 'post-1' }) });
    expect(res.status).toBe(403);
  });

  it('requires CSRF for POST /api/admin/predictions/csv/confirm', async () => {
    const { POST } = await import('@/app/api/admin/predictions/csv/confirm/route');
    const req = crossOriginReq('http://localhost/api/admin/predictions/csv/confirm', {
      method: 'POST',
      body: JSON.stringify({}),
    });

    const res = await POST(req);
    expect(res.status).toBe(403);
  });
});
