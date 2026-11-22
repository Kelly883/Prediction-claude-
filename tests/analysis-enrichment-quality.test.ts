import { describe, expect, it } from 'vitest';

import { classifyEnrichment, describeQuality } from '@/lib/analysis/ingestion/quality';
import type { FixtureEnrichment } from '@/types/analysis';

const complete: FixtureEnrichment = {
  homeStats: { xgFor: 2.1, xgAgainst: 0.7 },
  awayStats: { xgFor: 0.8, xgAgainst: 1.6 },
  h2h: { matches: 10, homeWins: 6, draws: 2, awayWins: 2 },
  injuries: { home: 1, away: 2 },
  odds: { matchResult: { home: 1.7, draw: 3.6, away: 4.5 } },
  players: [{ name: 'Striker', goals: 10 }],
};

describe('enrichment quality classification (Stage 6)', () => {
  it('labels complete API-Football enrichment as PRIMARY_COMPLETE', () => {
    const result = classifyEnrichment('api-football', complete);
    expect(result.quality).toBe('PRIMARY_COMPLETE');
    expect(result.missingFields).toEqual([]);
  });

  it('labels partial API-Football enrichment as PRIMARY_PARTIAL and lists what is missing', () => {
    const result = classifyEnrichment('api-football', {
      homeStats: { xgFor: 2 },
      awayStats: { xgFor: 1 },
    });
    expect(result.quality).toBe('PRIMARY_PARTIAL');
    expect(result.missingFields).toEqual(expect.arrayContaining(['odds', 'h2h', 'injuries', 'players']));
  });

  it('never labels fallback-only enrichment as primary or complete', () => {
    const result = classifyEnrichment('football-data', {
      homeStats: { goalsFor: 18, goalsAgainst: 9 },
      awayStats: { goalsFor: 14, goalsAgainst: 11 },
    });
    expect(result.quality).toBe('FALLBACK_PARTIAL');
    expect(result.quality).not.toBe('PRIMARY_COMPLETE');
  });

  it('treats fallback enrichment without team stats as insufficient', () => {
    const result = classifyEnrichment('football-data', { odds: { matchResult: { home: 2 } } });
    expect(result.quality).toBe('INSUFFICIENT_DATA');
  });

  it('treats empty enrichment as insufficient for either provider', () => {
    expect(classifyEnrichment('api-football', {}).quality).toBe('INSUFFICIENT_DATA');
    expect(classifyEnrichment('football-data', {}).quality).toBe('INSUFFICIENT_DATA');
    // Players alone (no team stats/odds/h2h) are not usable enrichment.
    expect(classifyEnrichment('football-data', { players: [{ name: 'X' }] }).quality).toBe('INSUFFICIENT_DATA');
  });

  it('exposes a human-readable description for admin surfaces', () => {
    expect(describeQuality('PRIMARY_COMPLETE')).toMatch(/primary provider/i);
    expect(describeQuality('PRIMARY_PARTIAL')).toMatch(/incomplete/i);
    expect(describeQuality('FALLBACK_PARTIAL')).toMatch(/fallback/i);
    expect(describeQuality('INSUFFICIENT_DATA')).toMatch(/insufficient/i);
  });
});
