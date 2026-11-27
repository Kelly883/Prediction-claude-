import { prisma } from './prisma';

export async function getCmsSections(page: string) {
  try {
    const sections = await prisma.cmsSection.findMany({
      where: { page },
      orderBy: { updatedAt: 'asc' },
    });

    // Order by the persisted `content.order` when present; rows without an
    // order keep their (stable) updatedAt order. Array.prototype.sort is stable
    // in Node, so equal keys preserve the query order.
    const sorted = [...sections].sort((a, b) => {
      const ao = (a.content as { order?: unknown })?.order;
      const bo = (b.content as { order?: unknown })?.order;
      const av = typeof ao === 'number' ? ao : Number.MAX_SAFE_INTEGER;
      const bv = typeof bo === 'number' ? bo : Number.MAX_SAFE_INTEGER;
      return av - bv;
    });

    const byKey: Record<string, unknown> = {};
    for (const s of sorted) {
      const content = s.content as { enabled?: unknown };
      // Disabled blocks are hidden from the public site.
      if (content && content.enabled === false) continue;
      byKey[s.key] = s.content;
    }
    return byKey;
  } catch {
    return {};
  }
}