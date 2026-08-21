import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockRbac = vi.hoisted(() => ({
  requireUser: vi.fn(),
  errorResponse: vi.fn(),
}));

vi.mock('@/lib/rbac', () => mockRbac);

function makeFakeDb() {
  const sessions = new Map<string, any>();
  let sequence = 0;

  const db: any = {
    userSession: {
      findMany: vi.fn(async ({ where, skip, take, orderBy }: any) => {
        let list = [...sessions.values()].filter((s) => s.userId === where.userId);
        if (orderBy?.lastSeenAt === 'desc') {
          list.sort((a: any, b: any) => (b.lastSeenAt?.getTime?.() ?? 0) - (a.lastSeenAt?.getTime?.() ?? 0));
        }
        return list.slice(skip ?? 0, (skip ?? 0) + (take ?? list.length));
      }),
      findUnique: vi.fn(async ({ where }: any) => sessions.get(where.id) ?? null),
      count: vi.fn(async ({ where }: any) => [...sessions.values()].filter((s) => s.userId === where.userId).length),
      delete: vi.fn(async ({ where }: any) => {
        const session = sessions.get(where.id);
        sessions.delete(where.id);
        return session;
      }),
      create: vi.fn(async ({ data }: any) => {
        const id = `sess-${++sequence}`;
        const record = { id, ...data, createdAt: new Date(), lastSeenAt: new Date() };
        sessions.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = sessions.get(where.id);
        if (!existing) throw new Error('Session not found');
        const updated = { ...existing, ...data };
        sessions.set(where.id, updated);
        return updated;
      }),
    },
    _seed(session: any) {
      sessions.set(session.id, session);
    },
    _getSessions: () => [...sessions.values()],
  };

  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue(undefined),
}));

describe('P1-02 Session Management APIs', () => {
  beforeEach(() => {
    fakeDb = makeFakeDb();
    mockRbac.requireUser.mockReset();
    mockRbac.errorResponse.mockImplementation((err: any) => {
      const status = err?.status ?? 500;
      return new Response(JSON.stringify({ error: err?.message ?? 'Internal server error' }), { status });
    });
  });

  describe('GET /api/me/sessions', () => {
    it('returns empty list when user has no sessions', async () => {
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });

      const { GET } = await import('@/app/api/me/sessions/route');
      const req = new NextRequest('http://localhost:3000/api/me/sessions');

      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toEqual([]);
    });

    it('returns user sessions scoped to authenticated user', async () => {
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });
      fakeDb._seed({ id: 'sess-1', userId: 'user-1', deviceFingerprint: 'fp-1', ip: '127.0.0.1', lastSeenAt: new Date(), createdAt: new Date() });
      fakeDb._seed({ id: 'sess-2', userId: 'user-2', deviceFingerprint: 'fp-2', ip: '127.0.0.2', lastSeenAt: new Date(), createdAt: new Date() });

      const { GET } = await import('@/app/api/me/sessions/route');
      const req = new NextRequest('http://localhost:3000/api/me/sessions');

      const res = await GET(req);
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data).toHaveLength(1);
      expect(data[0].id).toBe('sess-1');
      expect(data[0].userId).toBe('user-1');
    });
  });

  describe('DELETE /api/me/sessions/[id]', () => {
    it('revokes own session', async () => {
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });
      fakeDb._seed({ id: 'sess-1', userId: 'user-1', deviceFingerprint: 'fp-1', ip: '127.0.0.1', lastSeenAt: new Date(), createdAt: new Date() });

      const { DELETE } = await import('@/app/api/me/sessions/[id]/route');
      const req = new NextRequest('http://localhost:3000/api/me/sessions/sess-1', { method: 'DELETE' });

      const res = await DELETE(req, { params: { id: 'sess-1' } });
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.success).toBe(true);
    });

    it('prevents revoking another users session', async () => {
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-2', role: 'user' });
      fakeDb._seed({ id: 'sess-1', userId: 'user-1', deviceFingerprint: 'fp-1', ip: '127.0.0.1', lastSeenAt: new Date(), createdAt: new Date() });

      const { DELETE } = await import('@/app/api/me/sessions/[id]/route');
      const req = new NextRequest('http://localhost:3000/api/me/sessions/sess-1', { method: 'DELETE' });

      const res = await DELETE(req, { params: { id: 'sess-1' } });
      expect(res.status).toBe(403);
    });

    it('returns 404 for non-existent session', async () => {
      mockRbac.requireUser.mockResolvedValue({ sub: 'user-1', role: 'user' });

      const { DELETE } = await import('@/app/api/me/sessions/[id]/route');
      const req = new NextRequest('http://localhost:3000/api/me/sessions/nonexistent', { method: 'DELETE' });

      const res = await DELETE(req, { params: { id: 'nonexistent' } });
      expect(res.status).toBe(404);
    });
  });
});
