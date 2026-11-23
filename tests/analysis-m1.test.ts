import { describe, expect, it } from 'vitest';
import { isSuccessfullyAnalysed } from '@/lib/analysis/run';

function outcome(overrides: { best?: { market: string; confidence: number }; enrichmentQuality?: string | null } = {}): { best?: { market: string; confidence: number }; enrichmentQuality?: string | null } {
  return { best: { market: 'MATCH_RESULT', confidence: 82 }, enrichmentQuality: 'PRIMARY_COMPLETE', ...overrides };
}

describe('M1: isSuccessfullyAnalysed (cumulative successful fixture criteria)', () => {
  it('counts an outcome with a best market and sufficient data as successful', () => {
    expect(isSuccessfullyAnalysed(outcome())).toBe(true);
  });

  it('excludes an outcome with no best market (failed analysis)', () => {
    expect(isSuccessfullyAnalysed(outcome({ best: undefined }))).toBe(false);
  });

  it('excludes an INSUFFICIENT_DATA outcome even when it has a best market', () => {
    expect(isSuccessfullyAnalysed(outcome({ enrichmentQuality: 'INSUFFICIENT_DATA' }))).toBe(false);
  });

  it('excludes an outcome that is both missing a best market and insufficient data', () => {
    expect(isSuccessfullyAnalysed(outcome({ best: undefined, enrichmentQuality: 'INSUFFICIENT_DATA' }))).toBe(false);
  });

  it('treats null enrichment quality as successful (not INSUFFICIENT_DATA)', () => {
    expect(isSuccessfullyAnalysed(outcome({ enrichmentQuality: null }))).toBe(true);
  });
});
