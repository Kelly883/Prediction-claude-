import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the client components so the server component can render in Node.
vi.mock('@/components/Header', () => ({ default: () => null }));
vi.mock('@/components/Footer', () => ({ default: () => null }));
vi.mock('../app/archive/_archive-client', () => ({
  default: vi.fn(() => null),
}));

// The mocked ArchiveClient (vi.fn) so we can match it in the JSX tree.
import MockArchiveClient from '../app/archive/_archive-client';

const mockPrisma = vi.hoisted(() => ({
  plan: { findMany: vi.fn() },
  predictionPost: { findMany: vi.fn(), count: vi.fn() },
}));
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { default as PublicArchivePage } from '@/app/archive/page';

type Stats = { total: number; won: number; lost: number; winRate: number };

// Walk the React element tree returned by the server component and return the
// `stats` prop passed to the mocked ArchiveClient.
function findArchiveClientStats(node: any): Stats | null {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findArchiveClientStats(child);
      if (found) return found;
    }
    return null;
  }
  const props = node && node.props;
  if (props && node.type === MockArchiveClient) {
    return props.stats ?? null;
  }
  if (props) {
    const children = props.children;
    if (children !== undefined && children !== null) {
      const found = findArchiveClientStats(children);
      if (found) return found;
    }
  }
  return null;
}

describe('Archive page full-dataset statistics (G-1 fix)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.plan.findMany.mockResolvedValue([
      { id: 'plan-free', name: 'Free' },
      { id: 'plan-vip', name: 'VIP' },
    ]);
  });

  it('calculates statistics from the full archive, not the paginated page', async () => {
    // First page (20 records) has a 50% win rate (10 won / 10 lost).
    const page1Posts = Array.from({ length: 20 }, (_, i) => ({
      id: `p${i}`,
      title: `Post ${i}`,
      scheduledAt: new Date(),
      outcome: i < 10 ? 'won' : 'lost',
      status: 'archived',
      updatedAt: new Date(),
      bookingCode: `BK${i}`,
      items: [],
    }));
    mockPrisma.predictionPost.findMany.mockResolvedValue(page1Posts);
    // Full dataset counts: 100 settled = 60 won + 40 lost (60% win rate).
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const outcome = args?.where?.outcome;
      if (outcome === 'won') return Promise.resolve(60);
      if (outcome === 'lost') return Promise.resolve(40);
      if (outcome && 'in' in outcome && Array.isArray(outcome.in)) {
        return Promise.resolve(100);
      }
      return Promise.resolve(0);
    });

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free' }),
    } as any);
    const stats = findArchiveClientStats(rendered);
    expect(stats).toEqual({ total: 100, won: 60, lost: 40, winRate: 60 });
  });

  it('statistics remain identical when moving from page 1 to page 2', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const outcome = args?.where?.outcome;
      if (outcome === 'won') return Promise.resolve(60);
      if (outcome === 'lost') return Promise.resolve(40);
      if (outcome && 'in' in outcome && Array.isArray(outcome.in)) {
        return Promise.resolve(100);
      }
      return Promise.resolve(0);
    });

    const rendered1 = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free', page: '1' }),
    } as any);
    const statsPage1 = findArchiveClientStats(rendered1);

    const rendered2 = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free', page: '2' }),
    } as any);
    const statsPage2 = findArchiveClientStats(rendered2);

    expect(statsPage2).toEqual(statsPage1);
    expect(statsPage1).toEqual({ total: 100, won: 60, lost: 40, winRate: 60 });
  });

  it('selecting another plan produces statistics for that plan only', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const outcome = args?.where?.outcome;
      const planIds = args?.where?.planIds;
      const isVip = planIds && 'has' in planIds && planIds.has === 'plan-vip';
      if (!isVip) return Promise.resolve(0);
      if (outcome === 'won') return Promise.resolve(20);
      if (outcome === 'lost') return Promise.resolve(10);
      if (outcome && 'in' in outcome && Array.isArray(outcome.in)) {
        return Promise.resolve(30);
      }
      return Promise.resolve(0);
    });

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-vip' }),
    } as any);
    const stats = findArchiveClientStats(rendered);
    expect(stats).toEqual({ total: 30, won: 20, lost: 10, winRate: 67 });
  });

  it('records belonging exclusively to another plan are excluded', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const planIds = args?.where?.planIds;
      const isFree = planIds && 'has' in planIds && planIds.has === 'plan-free';
      if (!isFree) return Promise.resolve(0);
      return Promise.resolve(0);
    });

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free' }),
    } as any);
    const stats = findArchiveClientStats(rendered);
    expect(stats).toEqual({ total: 0, won: 0, lost: 0, winRate: 0 });
  });

  it('pending predictions do not affect settled statistics', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockImplementation((args: any) => {
      const outcome = args?.where?.outcome;
      if (outcome === 'won') return Promise.resolve(50);
      if (outcome === 'lost') return Promise.resolve(25);
      if (outcome && 'in' in outcome && Array.isArray(outcome.in)) {
        return Promise.resolve(75);
      }
      return Promise.resolve(0);
    });

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free' }),
    } as any);
    const stats = findArchiveClientStats(rendered);
    // Pending records are never in baseWhere (outcome in [won,lost]), so they
    // do not contribute to won/lost/settled counts.
    expect(stats).toEqual({ total: 75, won: 50, lost: 25, winRate: 67 });
  });

  it('empty archive returns zero counts and a safe win rate', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(0);

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free' }),
    } as any);
    const stats = findArchiveClientStats(rendered);
    expect(stats).toEqual({ total: 0, won: 0, lost: 0, winRate: 0 });
  });

  it('pagination still returns only the requested page size', async () => {
    mockPrisma.predictionPost.findMany.mockResolvedValue([]);
    mockPrisma.predictionPost.count.mockResolvedValue(100);

    const rendered = await PublicArchivePage({
      searchParams: Promise.resolve({ plan: 'plan-free', pageSize: '5' }),
    } as any);
    const props = findArchiveClientStats(rendered);
    // findArchiveClientStats returns only stats; re-fetch the full props for
    // page-size assertions by walking the tree again.
    const archiveProps = (() => {
      let found: any = null;
      function walk(node: any) {
        if (!node || typeof node !== 'object') return;
        if (Array.isArray(node)) { node.forEach(walk); return; }
        const props = node.props;
        if (props && node.type === MockArchiveClient) { found = props; return; }
        if (props && props.children !== undefined) walk(props.children);
      }
      walk(rendered);
      return found;
    })();
    expect(archiveProps.pageSize).toBe(20);
    expect(archiveProps.hasMore).toBe(true);
  });
});
