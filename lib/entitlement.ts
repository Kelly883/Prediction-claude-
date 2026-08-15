import { PredictionPost } from '@prisma/client';
import { prisma } from './prisma';

/**
 * Core paywall rule (PRD Section 5 / design doc Section 4), in priority order:
 *   admin bypass -> complimentary access -> active free rule/window ->
 *   post.freeUntil -> active subscription covering the post's category.
 * This is the ONLY place that decides visibility — every route that returns
 * prediction content must call this server-side and never trust a client flag.
 */
export async function canView(userId: string | null, post: PredictionPost): Promise<boolean> {
  if (!userId) return false;

  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) return false;
  if (user.role === 'admin') return true;

  const now = new Date();

  const comp = await prisma.complimentaryAccess.findFirst({
    where: {
      userId,
      OR: [{ postId: post.id }, { postId: null }],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
    },
  });
  if (comp) return true;

  const activeRules = await prisma.freeAccessRule.findMany({ where: { isActive: true } });
  for (const rule of activeRules) {
    if (rule.type === 'promo_window' && rule.startAt && rule.endAt && rule.startAt <= now && rule.endAt >= now) {
      return true;
    }
    // Global trial: N days from the user's own signup date, not a shared
    // calendar window — a rule created today still gives a user who signed
    // up last week zero remaining trial days, which is the correct behavior
    // (it's "N days after you join", not "N days from when this rule exists").
    if (rule.type === 'global_trial' && rule.trialDays) {
      const trialEnd = new Date(user.createdAt.getTime() + rule.trialDays * 24 * 60 * 60 * 1000);
      if (now < trialEnd) return true;
    }
  }

  if (post.freeUntil && now < post.freeUntil) return true;

  const activeSub = await prisma.subscription.findFirst({
    where: { userId, status: 'active', endAt: { gt: now } },
    include: { plan: true },
    orderBy: { endAt: 'desc' },
  });

  if (activeSub?.plan) {
    if (!activeSub.plan.categoryIds || activeSub.plan.categoryIds.length === 0) return true;
    const overlaps = post.categoryIds.some((c) => activeSub.plan!.categoryIds.includes(c));
    if (overlaps) return true;
  }

  return false;
}

/** Strips content that must not leak to a non-entitled viewer. */
export function toTeaser(post: PredictionPost, matchCount: number) {
  return {
    id: post.id,
    title: post.title,
    scheduledAt: post.scheduledAt,
    categoryIds: post.categoryIds,
    status: post.status,
    matchCount,
    locked: true,
  };
}
