import { prisma } from './prisma';

export async function getActivePlans() {
  try {
    return await prisma.plan.findMany({ where: { isActive: true }, orderBy: { priceNGN: 'asc' } });
  } catch {
    return [];
  }
}
