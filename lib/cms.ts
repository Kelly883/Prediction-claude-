import { prisma } from './prisma';

export async function getCmsSections(page: string) {
  try {
    const sections = await prisma.cmsSection.findMany({ where: { page } });
    const byKey: Record<string, any> = {};
    for (const s of sections) byKey[s.key] = s.content;
    return byKey;
  } catch {
    return {};
  }
}
