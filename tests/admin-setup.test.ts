import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

function makeFakeDb() {
  const users = new Map<string, any>();
  const auditLogs: any[] = [];
  const sessions: any[] = [];

  const db: any = {
    user: {
      count: vi.fn(async ({ where }: any = {}) => {
        let list = [...users.values()];
        if (where?.role) {
          list = list.filter((u) => u.role === where.role);
        }
        return list.length;
      }),
      create: vi.fn(async ({ data }: any) => {
        if ([...users.values()].some((u) => u.email === data.email)) {
          const err: any = new Error('Unique constraint failed on email');
          err.code = 'P2002';
          throw err;
        }
        const record = { id: `usr-${users.size + 1}`, tokenVersion: 0, ...data };
        users.set(record.id, record);
        return record;
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.email) {
          return [...users.values()].find((u) => u.email === where.email) ?? null;
        }
        return users.get(where.id) ?? null;
      }),
    },
    userSession: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async ({ data }: any) => {
        const s = { id: `sess-${sessions.length + 1}`, ...data };
        sessions.push(s);
        return s;
      }),
      update: vi.fn(async ({ data }: any) => data),
    },
    auditLog: {
      create: vi.fn(async ({ data }: any) => {
        auditLogs.push(data);
        return data;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _users: users,
    _auditLogs: auditLogs,
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

vi.mock('@/lib/ratelimit', async () => {
  const actual = await vi.importActual<any>('@/lib/ratelimit');
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => true),
    authLimiter: {},
    adminLimiter: {},
    getClientIp: () => '127.0.0.1',
  };
});

describe('One-Time Admin Setup API & Bootstrap Security', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    delete process.env.ADMIN_BOOTSTRAP_SECRET;
    process.env.ALLOW_ADMIN_BOOTSTRAP_WITHOUT_SECRET = 'true';
  });

  it('reports isSetupAvailable=true when no admin exists in the database', async () => {
    const { GET } = await import('@/app/api/auth/admin-setup/route');
    const req = new NextRequest('http://localhost:3000/api/auth/admin-setup');
    const res = await GET(req);
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.isSetupAvailable).toBe(true);
  });

  it('provisions the initial admin without auto-login', async () => {
    const { POST, GET } = await import('@/app/api/auth/admin-setup/route');

    const req = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Initial Admin',
        email: 'admin@predictpro.com',
        phone: '+2348012345678',
        password: 'SuperSecretPassword123!',
        country: 'NG',
      }),
    });

    const res = await POST(req);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.role).toBe('admin');
    expect(data.email).toBe('admin@predictpro.com');
    expect(data.requirePasswordChange).toBe(true);

    // No cookies should be set — operator must log in manually
    expect(res.cookies.get('access_token')).toBeUndefined();
    expect(res.cookies.get('refresh_token')).toBeUndefined();

    // After creation, setup status must report isSetupAvailable=false
    const getReq = new NextRequest('http://localhost:3000/api/auth/admin-setup');
    const getRes = await GET(getReq);
    const getData = await getRes.json();
    expect(getData.isSetupAvailable).toBe(false);
  });

  it('rejects subsequent admin registrations once an admin exists', async () => {
    const { POST } = await import('@/app/api/auth/admin-setup/route');

    // Create first admin
    const firstReq = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'First Admin',
        email: 'first@predictpro.com',
        phone: '+2348011111111',
        password: 'Password123!',
        country: 'NG',
      }),
    });
    const firstRes = await POST(firstReq);
    expect(firstRes.status).toBe(200);

    // Attempt second admin registration
    const secondReq = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Second Admin',
        email: 'second@predictpro.com',
        phone: '+2348022222222',
        password: 'Password123!',
        country: 'NG',
      }),
    });
    const secondRes = await POST(secondReq);
    const secondData = await secondRes.json();

    expect(secondRes.status).toBe(403);
    expect(secondData.error).toMatch(/already been registered|Initial setup is deactivated/i);
  });

  it('enforces ADMIN_BOOTSTRAP_SECRET when configured', async () => {
    process.env.ADMIN_BOOTSTRAP_SECRET = 'strong-bootstrap-secret-999';

    const { POST } = await import('@/app/api/auth/admin-setup/route');

    // Attempt without secret header
    const unauthReq = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Secret Admin',
        email: 'secret@predictpro.com',
        phone: '+2348033333333',
        password: 'Password123!',
        country: 'NG',
      }),
    });
    const unauthRes = await POST(unauthReq);
    expect(unauthRes.status).toBe(403);

    // Attempt with correct secret header
    const authReq = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-admin-bootstrap-secret': 'strong-bootstrap-secret-999',
      },
      body: JSON.stringify({
        name: 'Secret Admin',
        email: 'secret@predictpro.com',
        phone: '+2348033333333',
        password: 'Password123!',
        country: 'NG',
      }),
    });
    const authRes = await POST(authReq);
    expect(authRes.status).toBe(200);
  });

  it('prevents concurrent bootstrap race from creating multiple admins', async () => {
    const { POST, GET } = await import('@/app/api/auth/admin-setup/route');

    const req1 = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Race Admin 1',
        email: 'race1@predictpro.com',
        phone: '+2348011111111',
        password: 'Password123!',
        country: 'NG',
      }),
    });

    const req2 = new NextRequest('http://localhost:3000/api/auth/admin-setup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Race Admin 2',
        email: 'race2@predictpro.com',
        phone: '+2348022222222',
        password: 'Password123!',
        country: 'NG',
      }),
    });

    const [res1, res2] = await Promise.all([POST(req1), POST(req2)]);

    const successes = [res1, res2].filter((r) => r.status === 200);
    const failures = [res1, res2].filter((r) => r.status !== 200);

    expect(successes.length).toBeLessThanOrEqual(1);
    expect(failures.length).toBeGreaterThanOrEqual(1);

    const getRes = await GET(new NextRequest('http://localhost:3000/api/auth/admin-setup'));
    const getData = await getRes.json();
    expect(getData.isSetupAvailable).toBe(false);
  });
});
