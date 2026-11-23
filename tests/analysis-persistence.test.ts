import { describe, expect, it } from 'vitest';
import { toPersistableResult } from '@/lib/analysis/persistence';
import type { AnalysisOutcome, Fixture, MarketType } from '@/types/analysis';

const FIXTURE: Fixture = {
  id: 'fx-1',
  leagueCode: 'PL',
  leagueName: 'English Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

function outcome(overrides: {
  confidence?: number;
  odds?: number | null;
  scores?: AnalysisOutcome['scores'];
} = {}): AnalysisOutcome {
  const odds = overrides.odds === undefined ? 1.91 : overrides.odds;
  const best = {
    market: 'MATCH_RESULT' as MarketType,
    selection: 'Home FC',
    odds,
    oddsAvailable: odds !== null,
    confidence: overrides.confidence ?? 82,
    confidenceLabel: 'HEURISTIC_MODEL_SCORE',
    factors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
    evidence: {
      label: 'VERIFIED' as const,
      dataQuality: 'PRIMARY_COMPLETE' as const,
      oddsAvailability: 'AVAILABLE' as const,
      strength: 1,
      sources: [] as string[],
    },
  };
  return {
    fixture: FIXTURE,
    scores: overrides.scores ?? [best],
    best,
    eligibility: [],
    dataQuality: 'PRIMARY_COMPLETE' as const,
    evidenceLabel: 'VERIFIED' as const,
    topFactors: [{ name: 'homeXgVsAwayXg', score: 80, weight: 0.3 }],
  };
}

describe('toPersistableResult', () => {
  it('maps a valid outcome to a persistable row', () => {
    const row = toPersistableResult('run-1', outcome());

    expect(row).toMatchObject({
      runId: 'run-1',
      fixtureId: 'fx-1',
      league: 'PL',
      bestMarket: 'MATCH_RESULT',
      bestSelection: 'Home FC',
      bestOdds: 1.91,
      confidence: 82,
    });
    expect(row.marketScores).toHaveLength(1);
    expect(row.topFactors).toHaveLength(1);
  });

  it('persists unavailable odds as null, never a fabricated price', () => {
    const row = toPersistableResult('run-1', outcome({ odds: null }));
    expect(row.bestOdds).toBeNull();
    expect(row.oddsSource).toBeNull();
  });

  it('rejects a non-finite confidence', () => {
    expect(() => toPersistableResult('run-1', outcome({ confidence: Number.NaN }))).toThrow(/Invalid confidence/);
  });

  it('rejects a confidence above 100', () => {
    expect(() => toPersistableResult('run-1', outcome({ confidence: 120 }))).toThrow(/Invalid confidence/);
  });

  it('rejects non-positive odds', () => {
    expect(() => toPersistableResult('run-1', outcome({ odds: 0 }))).toThrow(/Invalid bestOdds/);
  });

  it('rejects an empty marketScores array', () => {
    expect(() => toPersistableResult('run-1', outcome({ scores: [] }))).toThrow(/Invalid marketScores/);
  });

  it('rejects a market score with no factors', () => {
    const bad = outcome();
    bad.scores[0] = { ...bad.scores[0], factors: [] };
    expect(() => toPersistableResult('run-1', bad)).toThrow(/Invalid marketScores/);
  });

  it('rejects an out-of-range model probability', () => {
    const bad = outcome();
    bad.scores[0] = { ...bad.scores[0], modelProbability: 1.4 };
    expect(() => toPersistableResult('run-1', bad)).toThrow(/Invalid marketScores/);
  });

  it('rejects a fixture with no identity', () => {
    const bad = outcome();
    bad.fixture = { ...FIXTURE, id: '' };
    expect(() => toPersistableResult('run-1', bad)).toThrow(/Invalid fixture identity/);
  });

  it('rejects malformed top factors', () => {
    const bad = outcome();
    bad.topFactors = [{ name: 'homeXgVsAwayXg', score: Number.NaN, weight: 0.3 }];
    expect(() => toPersistableResult('run-1', bad)).toThrow(/Invalid topFactors/);
  });
});
