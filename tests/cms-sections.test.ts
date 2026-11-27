import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CmsSectionUpdateSchema } from '@/lib/schemas';

const mockPrisma = vi.hoisted(() => ({
  cmsSection: { findMany: vi.fn() },
}));

vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }));

import { getCmsSections } from '@/lib/cms';

describe('CmsSectionUpdateSchema', () => {
  it('preserves order and enabled stored in the content JSON', () => {
    const parsed = CmsSectionUpdateSchema.parse({
      key: 'faq_1',
      content: { heading: 'H', body: 'B', order: 2, enabled: false },
    });
    expect(parsed.content.order).toBe(2);
    expect(parsed.content.enabled).toBe(false);
  });

  it('still accepts legacy content without order/enabled', () => {
    const parsed = CmsSectionUpdateSchema.parse({ key: 'intro', content: { heading: 'Hi', body: 'There' } });
    expect(parsed.content.order).toBeUndefined();
    expect(parsed.content.enabled).toBeUndefined();
  });
});

describe('getCmsSections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('excludes disabled blocks and orders by content.order', async () => {
    mockPrisma.cmsSection.findMany.mockResolvedValue([
      { key: 'b', content: { heading: 'B', body: 'b', order: 1 } },
      { key: 'a', content: { heading: 'A', body: 'a', order: 0 } },
      { key: 'hidden', content: { heading: 'H', body: 'h', order: 2, enabled: false } },
    ]);

    const sections = await getCmsSections('faq');
    expect(Object.keys(sections)).toEqual(['a', 'b']);
    expect(sections).not.toHaveProperty('hidden');
  });

  it('keeps blocks without an order after ordered ones (stable)', async () => {
    mockPrisma.cmsSection.findMany.mockResolvedValue([
      { key: 'legacy', content: { heading: 'L', body: 'l' } },
      { key: 'first', content: { heading: 'F', body: 'f', order: 0 } },
    ]);

    const sections = await getCmsSections('faq');
    expect(Object.keys(sections)).toEqual(['first', 'legacy']);
  });

  it('returns an empty object when the query throws', async () => {
    mockPrisma.cmsSection.findMany.mockRejectedValue(new Error('db down'));
    await expect(getCmsSections('faq')).resolves.toEqual({});
  });
});