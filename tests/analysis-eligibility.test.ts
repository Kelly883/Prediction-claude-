import { describe, expect, it } from 'vitest';

import { DEFAULT_MARKET_WEIGHTS, MARKET_ORDER } from '@/lib/analysis/config';
import {
  DEFAULT_ELIGIBILITY_POLICY,
  evaluateAllEligibility,
  evaluateMarketEligibility,
  marketRequiresOdds,
} from '@/lib/analysis/markets/eligibility';
import { scoreFixture } from '@/lib/analysis/engine';
import { matchResultDirection, scoreOf } from '@/lib/analysis/markets/shared';
import { scoreOverUnder } from '@/lib/analysis/markets/overUnder';
import { toPersistableResult } from '@/lib/analysis/persistence';
import type { Fixture, FixtureEnrichment } from '@/types/analysis';

const fixture: Fixture = {
  id: 'fx-elig',
  leagueCode: 'PL',
  leagueName: 'Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

/** Enrichment with every group present — should satisfy every enabled market. */
const complete: FixtureEnrichment = {
  homeStats: {
    xgFor: 2.1,
    xgAgainst: 0.7,
    goalsFor: 2,
    goalsAgainst: 0.8,
    form: ['W', 'W', 'D'],
    cornersFor: 6,
    cardsFor: 1,
    firstHalfGoalsFor: 1.1,
  },
  awayStats: {
    xgFor: 0.8,
    xgAgainst: 1.6,
    goalsFor: 0.9,
    goalsAgainst: 1.5,
    form: ['L', 'D', 'L'],
    cornersFor: 4,
    cardsFor: 3,
  },
  h2h: { matches: 10, homeWins: 6, draws: 2, awayWins: 2, bttsRate: 0.4, over25Rate: 0.5 },
  injuries: { home: 1, away: 2, keyHome: 0, keyAway: 1 },
  odds: {
    matchResult: { home: 1.7, draw: 3.6, away: 4.5 },
    btts: { yes: 1.9, no: 1.9 },
    overUnder25: { over: 1.8, under: 2.0 },
    asianHandicap: { home: 1.9, away: 1.95, line: -0.5 },
    doubleChance: { homeDraw: 1.25 },
    correctScore: { '2-0': 7.5 },
  },
  players: [{ name: 'Striker', goals: 10, minutes: 900, penalties: 2, position: 'forward' }],
  dataSource: 'api-football',
  quality: 'PRIMARY_COMPLETE',
};

describe('market eligibility gate (Stage 4)', () => {
  it('records a structured decision for every configured market', () => {
    const decisions = evaluateAllEligibility(MARKET_ORDER, complete);
    expect(decisions).toHaveLength(10);
    expect(decisions.map((decision) => decision.market)).toEqual(MARKET_ORDER);
    for (const decision of decisions) {
      expect(decision).toMatchObject({
        market: expect.any(String),
        eligible: expect.any(Boolean),
        reason: expect.any(String),
        missingFields: expect.any(Array),
        dataSources: expect.any(Array),
        dataQuality: expect.any(String),
        oddsAvailable: expect.any(Boolean),
        allowedToProceed: expect.any(Boolean),
      });
    }
  });

  it('disables Total Cards, First Half Result and Player Scorer by policy', () => {
    for (const market of ['TOTAL_CARDS', 'FIRST_HALF_RESULT', 'PLAYER_SCORER'] as const) {
      const decision = evaluateMarketEligibility(market, complete);
      expect(decision.eligible).toBe(false);
      expect(decision.allowedToProceed).toBe(false);
      expect(decision.reason).toMatch(/disabled by policy/i);
      expect(decision.missingFields).toContain('policy:disabled');
    }
    expect(DEFAULT_ELIGIBILITY_POLICY.disabledMarkets).toEqual(['TOTAL_CARDS', 'FIRST_HALF_RESULT', 'PLAYER_SCORER']);
  });

  it('requires scoring inputs on both sides for Match Result', () => {
    const empty = evaluateMarketEligibility('MATCH_RESULT', {});
    expect(empty.allowedToProceed).toBe(false);
    expect(empty.missingFields).toEqual(['homeScoring', 'awayScoring']);

    const halfData = evaluateMarketEligibility('MATCH_RESULT', { homeStats: { xgFor: 2 } });
    expect(halfData.allowedToProceed).toBe(false);
    expect(halfData.missingFields).toContain('awayScoring');

    const both = evaluateMarketEligibility('MATCH_RESULT', { homeStats: { xgFor: 2 }, awayStats: { xgFor: 0.5 } });
    expect(both.allowedToProceed).toBe(true);
    expect(both.missingFields).toEqual([]);
  });

  it('requires conceding inputs for BTTS so a number alone cannot unlock it', () => {
    const noConceding = evaluateMarketEligibility('BTTS', { homeStats: { xgFor: 2 }, awayStats: { xgFor: 0.5 } });
    expect(noConceding.allowedToProceed).toBe(false);
    expect(noConceding.missingFields).toEqual(['homeConceding', 'awayConceding']);

    const complete2 = evaluateMarketEligibility('BTTS', {
      homeStats: { xgFor: 2, xgAgainst: 1 },
      awayStats: { xgFor: 0.5, xgAgainst: 1.2 },
    });
    expect(complete2.allowedToProceed).toBe(true);
  });

  it('self-gates Asian Handicap on a captured bookmaker handicap line', () => {
    const noLine = evaluateMarketEligibility('ASIAN_HANDICAP', { homeStats: { xgFor: 2 }, awayStats: { xgFor: 1 } });
    expect(noLine.allowedToProceed).toBe(false);
    expect(noLine.reason).toMatch(/handicap line/i);
    expect(noLine.missingFields).toEqual(['odds.asianHandicap.line']);

    const withLine = evaluateMarketEligibility('ASIAN_HANDICAP', {
      homeStats: { xgFor: 2 },
      awayStats: { xgFor: 1 },
      odds: { asianHandicap: { line: -0.5 } },
    });
    expect(withLine.allowedToProceed).toBe(true);
    expect(withLine.oddsAvailable).toBe(true);
  });

  it('restricts Total Corners until verified corner data exists for both teams', () => {
    const missingCorners = evaluateMarketEligibility('TOTAL_CORNERS', { homeStats: { cornersFor: 5 } });
    expect(missingCorners.allowedToProceed).toBe(false);
    expect(missingCorners.missingFields).toEqual(['awayCorners']);
    expect(missingCorners.reason).toMatch(/restricted/i);

    const verified = evaluateMarketEligibility('TOTAL_CORNERS', {
      homeStats: { cornersFor: 5 },
      awayStats: { cornersFor: 4 },
    });
    expect(verified.allowedToProceed).toBe(true);
  });

  it('applies stricter (form-required) rules to fallback-only enrichment', () => {
    const fallbackNoForm = evaluateMarketEligibility('MATCH_RESULT', {
      homeStats: { xgFor: 2 },
      awayStats: { xgFor: 0.5 },
      dataSource: 'football-data',
      quality: 'FALLBACK_PARTIAL',
    });
    expect(fallbackNoForm.allowedToProceed).toBe(false);
    expect(fallbackNoForm.missingFields).toEqual(['homeForm', 'awayForm']);

    const fallbackWithForm = evaluateMarketEligibility('MATCH_RESULT', {
      homeStats: { xgFor: 2, form: ['W'] },
      awayStats: { xgFor: 0.5, form: ['D'] },
      dataSource: 'football-data',
      quality: 'FALLBACK_PARTIAL',
    });
    expect(fallbackWithForm.allowedToProceed).toBe(true);
  });

  it('exposes the actual data source and quality on each decision', () => {
    const decision = evaluateMarketEligibility('MATCH_RESULT', complete);
    expect(decision.dataSources).toEqual(['api-football']);
    expect(decision.dataQuality).toBe('PRIMARY_COMPLETE');
    expect(decision.oddsAvailable).toBe(true);
  });

  it('flags odds availability without requiring odds for analytical markets', () => {
    const withoutOdds = evaluateMarketEligibility('MATCH_RESULT', { homeStats: { xgFor: 2 }, awayStats: { xgFor: 0.5 } });
    expect(withoutOdds.oddsAvailable).toBe(false);
    expect(withoutOdds.allowedToProceed).toBe(true); // analytical market, no price required

    expect(marketRequiresOdds('ASIAN_HANDICAP')).toBe(true);
    expect(marketRequiresOdds('MATCH_RESULT')).toBe(false);
  });
});

describe('eligibility gate enforced in the engine (Stage 4/7)', () => {
  it('only scores markets that passed the gate', () => {
    const outcome = scoreFixture(fixture, complete);
    const eligible = outcome.eligibility.filter((decision) => decision.allowedToProceed).map((decision) => decision.market);
    expect(outcome.scores.map((score) => score.market)).toEqual(eligible);
  });

  it('never scores a disabled market even when its inputs exist', () => {
    const outcome = scoreFixture(fixture, complete);
    const scored = outcome.scores.map((score) => score.market);
    expect(scored).not.toContain('TOTAL_CARDS');
    expect(scored).not.toContain('FIRST_HALF_RESULT');
    expect(scored).not.toContain('PLAYER_SCORER');
  });

  it('does not score BTTS when conceding data is missing', () => {
    const outcome = scoreFixture(fixture, { homeStats: { xgFor: 2 }, awayStats: { xgFor: 0.5 } });
    expect(outcome.scores.map((score) => score.market)).not.toContain('BTTS');
    expect(outcome.eligibility.find((decision) => decision.market === 'BTTS')?.allowedToProceed).toBe(false);
  });

  it('refuses to persist an outcome with no eligible market', () => {
    const outcome = scoreFixture(fixture, {});
    expect(outcome.best).toBeUndefined();
    expect(() => toPersistableResult('run-1', outcome)).toThrow(/No eligible market/);
  });
});

describe('evidence quality (Stage 7)', () => {
  it('does not let a missing side silently become zero in the Over/Under model', () => {
    const oneSide = scoreOverUnder({
      fixture,
      enrichment: { homeStats: { xgFor: 2 } },
      weights: DEFAULT_MARKET_WEIGHTS.OVER_UNDER_2_5,
    });
    const teamXg = oneSide.factors.find((factor) => factor.name === 'teamXg');
    // Neutral 50 (missing), NOT goalRateScore(2) which would be 0.
    expect(teamXg?.score).toBe(50);

    const bothSides = scoreOverUnder({
      fixture,
      enrichment: { homeStats: { xgFor: 4 }, awayStats: { xgFor: 3 } },
      weights: DEFAULT_MARKET_WEIGHTS.OVER_UNDER_2_5,
    });
    const combined = bothSides.factors.find((factor) => factor.name === 'teamXg');
    expect(combined?.score).toBeGreaterThan(50);
  });

  it('keeps the direction neutral when only one side has xG', () => {
    const { factors } = matchResultDirection({ homeStats: { xgFor: 2 } }, DEFAULT_MARKET_WEIGHTS.MATCH_RESULT);
    expect(scoreOf(factors, 'homeXgVsAwayXg')).toBe(50);
  });
});
