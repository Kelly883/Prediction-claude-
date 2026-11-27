import type { PredictionItem, PredictionPost } from '@prisma/client';

/**
 * Shared, pure helpers for the public daily prediction pages
 * (`app/predictions/today`, `app/predictions/tomorrow`).
 *
 * These functions contain the authoritative publication, visibility and
 * UTC-day selection rules so both pages behave identically and can be unit
 * tested without a database. The pages additionally push the same date bound
 * into the Prisma query purely to keep the payload small; correctness always
 * comes from this module.
 *
 * Match-status note (documented limitation): the public `PredictionPost` /
 * `PredictionItem` models carry no match-status field. `PredictionPost.outcome`
 * is the *prediction* result (pending/won/lost) and is only set when a post is
 * archived, so it must never be used to infer that a match is completed,
 * cancelled or postponed. `AnalysisResult.fixtureStatus` is a nullable,
 * provider-specific string that only exists for analysis-generated posts and is
 * not joined here. There is therefore no reliable per-item match status
 * available to these pages, and none is inferred.
 */

export interface UtcDayBounds {
  /** Inclusive lower bound (UTC midnight). */
  start: Date;
  /** Exclusive upper bound (next UTC midnight). */
  end: Date;
}

export interface VisibilityFields {
  visibility: string;
  freeUntil: Date | null;
}

export interface ItemDateFields {
  matchDateTime: Date | null;
}

/** Start-of-day (inclusive) and next-midnight (exclusive) in UTC. */
export function utcDayBounds(date: Date): UtcDayBounds {
  const start = new Date(date.getTime());
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(start.getTime());
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}

/** Add whole UTC calendar days to a date (DST-safe; UTC has no DST). */
export function addUtcDays(date: Date, days: number): Date {
  const d = new Date(date.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/**
 * Public visibility rule, mirroring the existing `isPubliclyVisible` behaviour:
 * a post is public when it is a `free_window` post, or its `freeUntil` is in
 * the future. Subscriber/plan-specific posts without an active free window are
 * private and must never have their content rendered on a public page.
 */
export function isPubliclyVisible(post: VisibilityFields, now: Date = new Date()): boolean {
  if (post.visibility === 'free_window') return true;
  if (post.freeUntil && post.freeUntil.getTime() > now.getTime()) return true;
  return false;
}

/** True when an item's kickoff falls within [start, end) in UTC. */
export function itemOccursOnUtcDay(item: ItemDateFields, bounds: UtcDayBounds): boolean {
  if (!item.matchDateTime) return false;
  const t = item.matchDateTime.getTime();
  return t >= bounds.start.getTime() && t < bounds.end.getTime();
}

export interface SelectedItem<TPost, TItem> {
  post: TPost;
  item: TItem;
}

export interface DailySelection<TPost, TItem> {
  /** Public items whose own kickoff is within the requested UTC day. */
  items: SelectedItem<TPost, TItem>[];
  /** Published posts that are not publicly visible but have >=1 item this day. */
  privatePostCount: number;
}

/**
 * Select the public items for a single UTC day from a set of published posts.
 *
 * - Private (subscriber/plan-specific) posts never contribute items; they only
 *   increment `privatePostCount` when they actually have an item on this day.
 * - Items are matched on their own `matchDateTime`, so a multi-item post is
 *   split across days correctly.
 * - Undated items (`matchDateTime === null`) are excluded.
 */
export function selectPublicItemsForDay<
  TPost extends VisibilityFields & { items: ReadonlyArray<ItemDateFields> },
>(
  posts: ReadonlyArray<TPost>,
  bounds: UtcDayBounds,
  now: Date = new Date(),
): DailySelection<TPost, TPost['items'][number]> {
  const items: SelectedItem<TPost, TPost['items'][number]>[] = [];
  let privatePostCount = 0;

  for (const post of posts) {
    const todaysItems = post.items.filter((item) => itemOccursOnUtcDay(item, bounds));
    if (!isPubliclyVisible(post, now)) {
      if (todaysItems.length > 0) privatePostCount += 1;
      continue;
    }
    for (const item of todaysItems) {
      items.push({ post, item });
    }
  }

  return { items, privatePostCount };
}

export type PublicPostWithItems = PredictionPost & { items: PredictionItem[] };

/**
 * Prisma query for a single UTC day's public page.
 *
 * Publication rule: `status: 'published'` only — `scheduled`, `draft` and
 * `archived` posts are never fetched, so scheduled (unpublished) predictions
 * can never reach these public pages. The item date bound (inclusive start,
 * exclusive end) keeps the payload small; `selectPublicItemsForDay` re-applies
 * the same bound as the source of truth.
 */
export function dailyPostQuery(bounds: UtcDayBounds) {
  return {
    where: {
      status: 'published' as const,
      items: { some: { matchDateTime: { gte: bounds.start, lt: bounds.end } } },
    },
    orderBy: { scheduledAt: 'asc' as const },
    include: {
      items: {
        where: { matchDateTime: { gte: bounds.start, lt: bounds.end } },
        orderBy: { matchDateTime: 'asc' as const },
      },
    },
  };
}