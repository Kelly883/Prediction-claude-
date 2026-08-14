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
        const record = { id: `usr-${users.size + 1}`, ...data };
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
    _users: users,
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
}));

describe('One-Time Admin Setup API', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
  });

  it('reports isSetupAvailable=true when no admin exists in the database', async () => {
    const { GET } = await import('@/app/api/auth/admin-setup/route');
    const res = await GET();
    const data = await res.json();
    expect(res.status).toBe(200);
    expect(data.isSetupAvailable).toBe(true);
    expect(data.adminCount).toBe(0);
  });

  it('provisions the initial admin and logs them in', async () => {
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

    // Cookies should be set for instant login
    expect(res.cookies.get('access_token')).toBeDefined();
    expect(res.cookies.get('refresh_token')).toBeDefined();

    // After creation, setup status must report isSetupAvailable=false
    const getRes = await GET();
    const getData = await getRes.json();
    expect(getData.isSetupAvailable).toBe(false);
    expect(getData.adminCount).toBe(1);
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
});
