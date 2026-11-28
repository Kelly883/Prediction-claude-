import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  plan: { findMany: vi.fn(), findUnique: vi.fn() },
  predictionPost: { findMany: vi.fn(), count: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  publicLimiter: {},
}));

vi.mock('@/lib/rbac', () => ({
  errorResponse: (err: any) => {
    const status = err?.statusCode || 500;
    return new Response(JSON.stringify({ error: err?.message || 'Internal Server Error' }), { status });
  },
}));

vi.mock('@/lib/pagination', () => ({
  parsePagination: (req: NextRequest) => {
    const url = new URL(req.url);
    const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, parseInt(url.searchParams.get('pageSize') || '20', 10) || 20));
    return { page, pageSize, cursor: undefined, offset: (page - 1) * pageSize };
  },
}));

import { GET } from '@/app/api/public/predictions/archive/route';

const baseUrl = 'http://localhost:3000/api/public/predictions/archive';

const post = (overrides: any = {}) => ({
  id: 'post-1',
  title: 'Weekend Match Predictions',
  scheduledAt: new Date('2026-11-28T15:00:00Z'),
  outcome: 'won',
  status: 'archived',
  updatedAt: new Date('2026-11-29T10:00:00Z'),
  bookingCode: 'BK123456',
  items: [{ match: 'Arsenal vs Chelsea', prediction: 'Home win' }],
  planIds: ['plan-free'],
  ...overrides,
});

describe('Public archive API — plan separation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const where = args?.where ?? {};
      const outcome = where.outcome;
      // Full-dataset counts for the default plan (plan-free):
      // 100 settled total = 60 won + 40 lost (60% win rate).
      if (outcome === 'won') return Promise.resolve(60);
      if (outcome === 'lost') return Promise.resolve(40);
      if (outcome && 'in' in outcome && Array.isArray(outcome.in)) {
        return Promise.resolve(100);
      }
      return Promise.resolve(0);
    });
    // VIP plan has different stats: 30 settled = 20 won + 10 lost.
    mockPrisma.plan.findUnique.mockImplementation(({ where }: any) => {
      const id = where?.id;
      if (id === 'plan-free' || id === 'plan-vip') {
        return Promise.resolve({ id, name: id.charAt(0).toUpperCase() + id.slice(1), isActive: true });
      }
      return Promise.resolve(null);
    });
  });

  it('returns only records belonging to the selected plan', async () => {
    const freePosts = [post({ id: 'p1', planIds: ['plan-free'] })];
    mockPrisma.predictionPost.findMany.mockResolvedValue(freePosts);
    mockPrisma.predictionPost.count.mockResolvedValue(1);

    const req = new NextRequest(`${baseUrl}?plan=plan-free`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].planIds).toBeUndefined(); // internal field not exposed
    expect(mockPrisma.predictionPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'archived',
          outcome: { in: ['won', 'lost'] },
          planIds: { has: 'plan-free' },
        }),
      }),
    );
  });

  it('selecting VIP returns only VIP records, not Free records', async () => {
    const vipPosts = [post({ id: 'p2', planIds: ['plan-vip'] })];
    mockPrisma.predictionPost.findMany.mockResolvedValue(vipPosts);
    mockPrisma.predictionPost.count.mockResolvedValue(1);

    const req = new NextRequest(`${baseUrl}?plan=plan-vip`);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.posts).toHaveLength(1);
    expect(json.posts[0].id).toBe('p2');
    expect(mockPrisma.predictionPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          planIds: { has: 'plan-vip' },
        }),
      }),
    );
  });

  it('switching plans updates the where clause (server-side filter)', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(0);

    await GET(new NextRequest(`${baseUrl}?plan=plan-free`));
    expect(mockPrisma.predictionPost.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ planIds: { has: 'plan-free' } }),
      }),
    );

    await GET(new NextRequest(`${baseUrl}?plan=plan-vip`));
    expect(mockPrisma.predictionPost.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ planIds: { has: 'plan-vip' } }),
      }),
    );
  });

  it('defaults to all archived won/lost records when no plan is supplied', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([post()]);
    mockPrisma.predictionPost.count.mockResolvedValue(1);

    const req = new NextRequest(baseUrl);
    const res = await GET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.posts).toHaveLength(1);
    expect(mockPrisma.predictionPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: 'archived',
          outcome: { in: ['won', 'lost'] },
        }),
      }),
    );
    // No planIds constraint when no plan selected.
    const callArg = mockPrisma.predictionPost.findMany.mock.calls[0][0];
    expect(callArg.where.planIds).toBeUndefined();
  });

  it('excludes pending/unpublished/draft records', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(0);

    await GET(new NextRequest(`${baseUrl}?plan=plan-free`));
    const where = mockPrisma.predictionPost.findMany.mock.calls[0][0].where;
    expect(where.status).toBe('archived');
    expect(where.outcome).toEqual({ in: ['won', 'lost'] });
    expect(where.outcome).not.toContain('pending');
    expect(where.outcome).not.toContain('draft');
  });

  it('does not expose internal analysis or raw payload fields', async () => {
    const richPost = post({
      items: [
        { match: 'A vs B', prediction: 'Home win' },
        { match: 'C vs D', prediction: 'Away win' },
      ],
    });
    mockPrisma.predictionPost.findMany.mockResolvedValue([richPost]);
    mockPrisma.predictionPost.count.mockResolvedValue(1);

    const res = await GET(new NextRequest(`${baseUrl}?plan=plan-free`));
    const json = await res.json();
    const returned = json.posts[0];
    expect(returned.rawPayload).toBeUndefined();
    expect(returned.analysisResult).toBeUndefined();
    expect(returned.items).toHaveLength(2);
    expect(returned.items[0]).toEqual({ match: 'A vs B', prediction: 'Home win' });
    expect(returned.items[0].matchDateTime).toBeUndefined();
  });

  it('booking code absent does not leak into response as null noise', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([post({ bookingCode: '' })]);
    mockPrisma.predictionPost.count.mockResolvedValue(1);

    const res = await GET(new NextRequest(`${baseUrl}?plan=plan-free`));
    const json = await res.json();
    expect(json.posts[0].bookingCode).toBe('');
  });

  it('pagination respects the selected plan', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(0);

    const res = await GET(new NextRequest(`${baseUrl}?plan=plan-vip&page=2&pageSize=10`));
    const call = mockPrisma.predictionPost.findMany.mock.calls[0][0];
    expect(call.skip).toBe(10);
    expect(call.take).toBe(10);
    expect(call.where.planIds).toEqual({ has: 'plan-vip' });
    const json = await res.json();
    expect(json.page).toBe(2);
    expect(json.pageSize).toBe(10);
  });

  it('rejects an unknown plan identifier with 400', async () => {
    mockPrisma.plan.findUnique.mockResolvedValue(null);

    const res = await GET(new NextRequest(`${baseUrl}?plan=plan-nonexistent`));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe('Invalid plan.');
    expect(mockPrisma.predictionPost.findMany).not.toHaveBeenCalled();
  });
});
