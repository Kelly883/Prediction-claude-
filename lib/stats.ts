import { prisma } from './prisma';

// Deliberately only surfaces counts we can actually back with real rows —
// no fabricated "win rate" claims. The schema has no outcome/result field
// on PredictionItem yet, so accuracy stats aren't something this ticker can
// honestly claim until that's tracked.
export async function getPublishedTipCount(): Promise<number> {
  try {
    return await prisma.predictionPost.count({ where: { status: 'published' } });
  } catch {
    return 0;
  }
}
