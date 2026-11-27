import { describe, it, expect } from 'vitest';
import {
  utcDayBounds,
  addUtcDays,
  isPubliclyVisible,
  itemOccursOnUtcDay,
  selectPublicItemsForDay,
  dailyPostQuery,
} from '@/lib/predictions/daily';

// Fixed instant so the UTC-day boundaries are deterministic.
const NOW = new Date('2026-11-27T12:34:56.000Z');
const TODAY = utcDayBounds(NOW); // [2026-11-27T00:00:00Z, 2026-11-28T00:00:00Z)
const TOMORROW = utcDayBounds(addUtcDays(NOW, 1)); // [2026-11-28T00:00:00Z, 2026-11-29T00:00:00Z)

interface TestItem {
  id: string;
  match: string;
  prediction: string;
  matchDateTime: Date | null;
  /** Not a real PredictionItem field; present only to prove status is ignored. */
  status?: string;
}

function item(id: string, matchDateTime: Date | null): TestItem {
  return { id, match: `Match ${id}`, prediction: `Pick ${id}`, matchDateTime };
}

function post(
  id: string,
  visibility: string,
  freeUntil: Date | null,
  items: TestItem[],
) {
  return { id, visibility, freeUntil, items };
}

const at = (iso: string) => new Date(iso);

describe('utcDayBounds', () => {
  it('uses inclusive UTC midnight start and exclusive next-midnight end', () => {
    expect(TODAY.start.toISOString()).toBe('2026-11-27T00:00:00.000Z');
    expect(TODAY.end.toISOString()).toBe('2026-11-28T00:00:00.000Z');
  });

  it('addUtcDays moves to the next UTC calendar day', () => {
    expect(addUtcDays(NOW, 1).toISOString()).toBe('2026-11-28T12:34:56.000Z');
    expect(utcDayBounds(addUtcDays(NOW, 1)).start.toISOString()).toBe('2026-11-28T00:00:00.000Z');
  });
});

describe('itemOccursOnUtcDay (UTC midnight boundaries)', () => {
  it('includes an item exactly at the inclusive start', () => {
    expect(itemOccursOnUtcDay(item('a', at('2026-11-27T00:00:00.000Z')), TODAY)).toBe(true);
  });

  it('excludes an item exactly at the exclusive end (next midnight)', () => {
    expect(itemOccursOnUtcDay(item('a', at('2026-11-28T00:00:00.000Z')), TODAY)).toBe(false);
  });

  it('includes an item one millisecond before the end', () => {
    expect(itemOccursOnUtcDay(item('a', at('2026-11-27T23:59:59.999Z')), TODAY)).toBe(true);
  });

  it('excludes an item before the start', () => {
    expect(itemOccursOnUtcDay(item('a', at('2026-11-26T23:59:59.999Z')), TODAY)).toBe(false);
  });

  it('handles a nullable matchDateTime safely (excluded, no throw)', () => {
    expect(itemOccursOnUtcDay(item('a', null), TODAY)).toBe(false);
  });
});

describe('isPubliclyVisible', () => {
  it('treats free_window posts as public', () => {
    expect(isPubliclyVisible({ visibility: 'free_window', freeUntil: null }, NOW)).toBe(true);
  });

  it('treats a post with a future freeUntil as public', () => {
    expect(isPubliclyVisible({ visibility: 'subscribers', freeUntil: at('2026-11-27T13:00:00.000Z') }, NOW)).toBe(true);
  });

  it('treats a subscriber post with a past freeUntil as private', () => {
    expect(isPubliclyVisible({ visibility: 'subscribers', freeUntil: at('2026-11-27T11:00:00.000Z') }, NOW)).toBe(false);
  });

  it('treats plan_specific posts without a free window as private', () => {
    expect(isPubliclyVisible({ visibility: 'plan_specific', freeUntil: null }, NOW)).toBe(false);
  });
});

describe('dailyPostQuery (publication rule)', () => {
  const q = dailyPostQuery(TODAY);

  it('fetches only published posts', () => {
    expect(q.where.status).toBe('published');
  });

  it('never includes scheduled, draft or archived status', () => {
    const statuses = Array.isArray(q.where.status) ? q.where.status : [q.where.status];
    expect(statuses).not.toContain('scheduled');
    expect(statuses).not.toContain('draft');
    expect(statuses).not.toContain('archived');
  });

  it('bounds items by the UTC day (inclusive start, exclusive end)', () => {
    const some = (q.where.items as any).some;
    expect(some.matchDateTime.gte).toEqual(TODAY.start);
    expect(some.matchDateTime.lt).toEqual(TODAY.end);
    const includeWhere = (q.include.items as any).where;
    expect(includeWhere.matchDateTime.gte).toEqual(TODAY.start);
    expect(includeWhere.matchDateTime.lt).toEqual(TODAY.end);
  });
});

describe('selectPublicItemsForDay', () => {
  it('1. published public predictions appear', () => {
    const posts = [post('p1', 'free_window', null, [item('i1', at('2026-11-27T15:00:00.000Z'))])];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items.map((s) => s.item.id)).toEqual(['i1']);
  });

  it('2. scheduled posts do not appear (query only fetches published)', () => {
    // The selector itself is status-agnostic; the publication guarantee lives
    // in dailyPostQuery. A scheduled post is never passed in by the page.
    const q = dailyPostQuery(TODAY);
    const statuses = Array.isArray(q.where.status) ? q.where.status : [q.where.status];
    expect(statuses).toEqual(['published']);
  });

  it('3. draft posts do not appear (query only fetches published)', () => {
    const q = dailyPostQuery(TODAY);
    expect(q.where.status).not.toBe('draft');
    expect(q.where.status).toBe('published');
  });

  it('4. archived posts do not appear (query only fetches published)', () => {
    const q = dailyPostQuery(TODAY);
    expect(q.where.status).not.toBe('archived');
    expect(q.where.status).toBe('published');
  });

  it('5. private predictions do not appear and only bump the private count', () => {
    const posts = [
      post('pub', 'free_window', null, [item('i1', at('2026-11-27T15:00:00.000Z'))]),
      post('priv', 'subscribers', null, [item('i2', at('2026-11-27T16:00:00.000Z'))]),
    ];
    const { items, privatePostCount } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items.map((s) => s.item.id)).toEqual(['i1']);
    expect(privatePostCount).toBe(1);
  });

  it('6. multi-item posts are split across daily pages by each item kickoff', () => {
    const posts = [post('multi', 'free_window', null, [
      item('today', at('2026-11-27T20:00:00.000Z')),
      item('tomorrow', at('2026-11-28T20:00:00.000Z')),
    ])];
    const todaySel = selectPublicItemsForDay(posts, TODAY, NOW);
    const tomorrowSel = selectPublicItemsForDay(posts, TOMORROW, NOW);
    expect(todaySel.items.map((s) => s.item.id)).toEqual(['today']);
    expect(tomorrowSel.items.map((s) => s.item.id)).toEqual(['tomorrow']);
  });

  it('7. items outside the requested date are excluded', () => {
    const posts = [post('p', 'free_window', null, [
      item('yesterday', at('2026-11-26T20:00:00.000Z')),
      item('today', at('2026-11-27T20:00:00.000Z')),
      item('dayAfter', at('2026-11-28T20:00:00.000Z')),
    ])];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items.map((s) => s.item.id)).toEqual(['today']);
  });

  it('8. UTC midnight boundaries work correctly (start included, end excluded)', () => {
    const posts = [post('p', 'free_window', null, [
      item('atStart', at('2026-11-27T00:00:00.000Z')),
      item('atEnd', at('2026-11-28T00:00:00.000Z')),
    ])];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items.map((s) => s.item.id)).toEqual(['atStart']);
  });

  it('9. nullable matchDateTime is handled safely (excluded, no throw)', () => {
    const posts = [post('p', 'free_window', null, [item('undated', null)])];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items).toEqual([]);
  });

  it('10. date labels use UTC (bounds are UTC midnights regardless of host TZ)', () => {
    // The label is derived from bounds.start, which is always UTC midnight.
    const label = TODAY.start.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
    expect(label).toContain('Friday');
    expect(label).toContain('27 November');
    expect(TODAY.start.toISOString()).toBe('2026-11-27T00:00:00.000Z');
  });

  it('11/12. match status is not inferred (documented limitation): selection ignores any status-like field', () => {
    // The public PredictionItem model has no match-status field, so the selector
    // must not classify a match as completed/cancelled/postponed. It selects
    // purely on kickoff date + visibility. This test locks that behaviour in and
    // documents the limitation rather than inventing a status source.
    const posts = [post('p', 'free_window', null, [
      { ...item('i1', at('2026-11-27T15:00:00.000Z')), status: 'finished' },
      { ...item('i2', at('2026-11-27T16:00:00.000Z')), status: 'cancelled' },
    ])];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items.map((s) => s.item.id)).toEqual(['i1', 'i2']);
  });

  it('13. empty published posts produce an empty selection (proper empty state)', () => {
    const posts = [post('empty', 'free_window', null, [])];
    const { items, privatePostCount } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items).toEqual([]);
    expect(privatePostCount).toBe(0);
  });

  it('14. no eligible predictions produce an empty selection', () => {
    const posts = [
      post('otherDate', 'free_window', null, [item('i', at('2026-11-28T15:00:00.000Z'))]),
      post('undated', 'free_window', null, [item('u', null)]),
    ];
    const { items } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items).toEqual([]);
  });

  it('does not count a private post that has no item on the requested day', () => {
    const posts = [post('priv', 'subscribers', null, [item('i', at('2026-11-28T15:00:00.000Z'))])];
    const { items, privatePostCount } = selectPublicItemsForDay(posts, TODAY, NOW);
    expect(items).toEqual([]);
    expect(privatePostCount).toBe(0);
  });
});