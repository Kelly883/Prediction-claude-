import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  complimentaryAccess: { findFirst: vi.fn() },
  freeAccessRule: { findMany: vi.fn() },
  subscription: { findFirst: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { canView, toTeaser } from '@/lib/entitlement';

const basePost = {
  id: 'post-1',
  title: 'Test post',
  scheduledAt: new Date(),
  categoryIds: ['epl'],
  bookingCode: 'AB12',
  bodyNotes: null,
  visibility: 'subscribers' as const,
  freeUntil: null,
  planIds: [],
  status: 'published' as const,
  outcome: 'pending' as const,
  createdById: 'admin-1',
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', createdAt: new Date() });
  mockPrisma.complimentaryAccess.findFirst.mockResolvedValue(null);
  mockPrisma.freeAccessRule.findMany.mockResolvedValue([]);
  mockPrisma.subscription.findFirst.mockResolvedValue(null);
});

describe('canView', () => {
  it('denies access with no user id', async () => {
    expect(await canView(null, basePost)).toBe(false);
  });

  it('always allows admins', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'admin-1', role: 'admin' });
    expect(await canView('admin-1', basePost)).toBe(true);
  });

  it('denies access with no subscription, no free rule, no comp access', async () => {
    expect(await canView('user-1', basePost)).toBe(false);
  });

  it('allows access via complimentary access', async () => {
    mockPrisma.complimentaryAccess.findFirst.mockResolvedValue({ id: 'c1', userId: 'user-1', postId: null, expiresAt: null });
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('allows access via an active promo window', async () => {
    mockPrisma.freeAccessRule.findMany.mockResolvedValue([
      { id: 'r1', type: 'promo_window', isActive: true, startAt: new Date(Date.now() - 60_000), endAt: new Date(Date.now() + 60_000) },
    ]);
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('denies access via a promo window that has not started yet', async () => {
    mockPrisma.freeAccessRule.findMany.mockResolvedValue([
      { id: 'r1', type: 'promo_window', isActive: true, startAt: new Date(Date.now() + 60_000), endAt: new Date(Date.now() + 120_000) },
    ]);
    expect(await canView('user-1', basePost)).toBe(false);
  });

  it('allows access via an active global trial within the user\'s trial window', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) }); // joined 2 days ago
    mockPrisma.freeAccessRule.findMany.mockResolvedValue([{ id: 'r1', type: 'global_trial', isActive: true, trialDays: 7 }]);
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('denies access via a global trial the user has already exhausted', async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }); // joined 30 days ago
    mockPrisma.freeAccessRule.findMany.mockResolvedValue([{ id: 'r1', type: 'global_trial', isActive: true, trialDays: 7 }]);
    expect(await canView('user-1', basePost)).toBe(false);
  });

  it('a global trial only checks trial days elapsed since the users own signup, not a shared calendar date', async () => {
    // A user who joined yesterday should get their full trial even if the
    // rule itself was created long before they signed up.
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', role: 'user', createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000) });
    mockPrisma.freeAccessRule.findMany.mockResolvedValue([{ id: 'r1', type: 'global_trial', isActive: true, trialDays: 14 }]);
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('allows access when post.freeUntil is in the future', async () => {
    const post = { ...basePost, freeUntil: new Date(Date.now() + 60_000) };
    expect(await canView('user-1', post)).toBe(true);
  });

  it('denies access when post.freeUntil is in the past', async () => {
    const post = { ...basePost, freeUntil: new Date(Date.now() - 60_000) };
    expect(await canView('user-1', post)).toBe(false);
  });

  it('allows access via an active subscription with accessScope=all', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 's1', status: 'active', endAt: new Date(Date.now() + 60_000),
      plan: { accessScope: 'all', categoryIds: [] },
    });
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('allows access via a category-scoped plan that covers the post category', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 's1', status: 'active', endAt: new Date(Date.now() + 60_000),
      plan: { accessScope: 'category', categoryIds: ['epl'] },
    });
    expect(await canView('user-1', basePost)).toBe(true);
  });

  it('denies access via a category-scoped plan that does not cover the post category', async () => {
    mockPrisma.subscription.findFirst.mockResolvedValue({
      id: 's1', status: 'active', endAt: new Date(Date.now() + 60_000),
      plan: { accessScope: 'category', categoryIds: ['laliga'] },
    });
    expect(await canView('user-1', basePost)).toBe(false);
  });
});

describe('toTeaser', () => {
  it('strips prediction content and marks the post locked', () => {
    const teaser = toTeaser(basePost, 3);
    expect(teaser.locked).toBe(true);
    expect(teaser.matchCount).toBe(3);
    expect(teaser).not.toHaveProperty('bookingCode');
  });
});
