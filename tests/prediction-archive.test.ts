import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  predictionPost: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
  auditLog: { create: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

vi.mock('@/lib/rbac', async (importOriginal) => {
  const actual: any = await importOriginal();
  return {
    ...actual,
    requirePermission: vi.fn().mockResolvedValue({ sub: 'admin-1', role: 'admin', permissions: [] }),
    requireUser: vi.fn().mockResolvedValue({ sub: 'user-1', role: 'user' }),
  };
});

vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn().mockResolvedValue({ id: 'audit-1' }),
}));

vi.mock('@/lib/ratelimit', () => ({
  checkRateLimit: vi.fn().mockResolvedValue(true),
  defaultLimiter: {},
}));

vi.mock('@/lib/entitlement', () => ({
  canView: vi.fn().mockResolvedValue(true),
  toTeaser: vi.fn().mockReturnValue({ locked: true }),
}));

import { GET as getAdminArchive } from '@/app/api/admin/predictions/archive/route';
import { GET as getMemberArchive } from '@/app/api/predictions/archive/route';

describe('Prediction Archive APIs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns only archived won/lost posts for admin', async () => {
    const posts = [
      { id: '1', title: 'Won Post', outcome: 'won', status: 'archived', items: [] },
      { id: '2', title: 'Lost Post', outcome: 'lost', status: 'archived', items: [] },
    ];
    mockPrisma.predictionPost.findMany.mockResolvedValue(posts);
    mockPrisma.predictionPost.count.mockResolvedValue(2);

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/archive');
    const res = await getAdminArchive(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(posts);
    expect(mockPrisma.predictionPost.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'archived', outcome: { in: ['won', 'lost'] } },
      })
    );
  });

  it('does not return pending or non-archived posts', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(0);

    const req = new NextRequest('http://localhost:3000/api/admin/predictions/archive');
    const res = await getAdminArchive(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual([]);
  });

  it('returns archive posts for members with entitlement check', async () => {
    const posts = [
      { id: '1', title: 'Won Post', outcome: 'won', status: 'archived', items: [] },
    ];
    mockPrisma.predictionPost.findMany.mockResolvedValue(posts);

    const req = new NextRequest('http://localhost:3000/api/predictions/archive');
    const res = await getMemberArchive(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual(posts.map((p) => ({ ...p, locked: false })));
  });
});
