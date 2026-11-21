import { describe, expect, it } from 'vitest';

import {
  confidenceFromDirection,
  confidenceFromPropensity,
  contrastScore,
  evidenceScore,
  oddsToConfidence,
  strengthDiffScore,
} from '@/lib/analysis/utils/confidence';
import {
  expectedScoreline,
  formScore,
  goalRateScore,
  h2hDrawScore,
  h2hHomeScore,
  h2hRateScore,
  motivationDiffScore,
  parseForm,
  playerPositionScore,
  scheduleScore,
  toNumber,
  weatherSupportsGoals,
} from '@/lib/analysis/utils/normalization';
import {
  buildFactors,
  goalRateScore as sharedGoalRateScore,
  injuriesImpact,
  oddsOrDefault,
  scoreOf,
  threeWaySelection,
  valueOr,
} from '@/lib/analysis/markets/shared';
import { scoreMatchResult, matchResultEvidenceScore } from '@/lib/analysis/markets/matchResult';
import { bestMarketOf, filterPicks, scoreFixture } from '@/lib/analysis/engine';
import {
  DEFAULT_MARKET_WEIGHTS,
  configDescriptionForSeed,
  configValueForSeed,
  validateConfigUpdate,
} from '@/lib/analysis/config';
import type { Fixture, FixtureEnrichment } from '@/types/analysis';

const fixture: Fixture = {
  id: 'util-fixture',
  leagueCode: 'PL',
  leagueName: 'English Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

const strongEnrichment: FixtureEnrichment = {
  homeStats: {
    xgFor: 2.4,
    xgAgainst: 0.6,
    goalsFor: 2.5,
    goalsAgainst: 0.5,
    form: ['W', 'W', 'D'],
    cornersFor: 7,
    cardsFor: 1,
    shotsFor: 18,
    firstHalfGoalsFor: 1.4,
  },
  awayStats: {
    xgFor: 0.6,
    xgAgainst: 2.1,
    goalsFor: 0.5,
    goalsAgainst: 2.3,
    form: ['L', 'L', 'D'],
    cornersFor: 3,
    cardsFor: 3,
    shotsFor: 7,
    firstHalfGoalsFor: 0.3,
  },
  h2h: { matches: 10, homeWins: 7, draws: 2, awayWins: 1, bttsRate: 0.3, over25Rate: 0.7 },
  injuries: { home: 0, away: 3, keyHome: 0, keyAway: 2 },
  odds: { matchResult: { home: 1.5, draw: 4.0, away: 6.0 } },
  motivation: { home: 90, away: 40 },
  schedule: { homeRestDays: 7, awayRestDays: 2 },
  referee: { cardsPerGame: 4.8 },
};

describe('confidence utilities', () => {
  it('computes contrast and strength-difference scores', () => {
    expect(contrastScore(80, 40)).toBe(70);
    expect(contrastScore(50, 50)).toBe(50);
    expect(strengthDiffScore(2, 1)).toBe(83.33);
    expect(strengthDiffScore(0, 0)).toBe(50);
  });

  it('derives a neutral score from missing or invalid odds', () => {
    expect(oddsToConfidence(undefined)).toBe(50);
    expect(oddsToConfidence(1)).toBe(50);
    expect(oddsToConfidence(0)).toBe(50);
    expect(oddsToConfidence(2)).toBe(50);
  });

  it('keeps directional confidence monotonic between neutral and extreme', () => {
    expect(confidenceFromDirection(50, 1)).toBe(50);
    expect(confidenceFromDirection(100, 1)).toBe(100);
    expect(confidenceFromPropensity(75, 0)).toBe(50);
    expect(evidenceScore([undefined, null, undefined])).toBe(0);
  });
});

describe('normalization utilities', () => {
  it('coerces numeric strings and rejects invalid values', () => {
    expect(toNumber(3)).toBe(3);
    expect(toNumber('3.5')).toBe(3.5);
    expect(toNumber('')).toBeUndefined();
    expect(toNumber('abc')).toBeUndefined();
    expect(toNumber(null)).toBeUndefined();
  });

  it('parses form from arrays and strings', () => {
    expect(parseForm(['W', 'lose', 'D'])).toEqual(['W', 'L', 'D']);
    expect(parseForm('WDLX')).toEqual(['W', 'D', 'L']);
    expect(parseForm(['X', 'Y'])).toBeUndefined();
    expect(parseForm([])).toBeUndefined();
    expect(parseForm(123)).toBeUndefined();
  });

  it('scores form and goal rates with neutral defaults', () => {
    expect(formScore(undefined)).toBe(50);
    expect(formScore(['W', 'D', 'L'])).toBe(50);
    expect(goalRateScore(undefined, 1.5)).toBe(50);
    expect(goalRateScore(2, 1)).toBe(74);
  });

  it('scores head-to-head signals', () => {
    expect(h2hHomeScore(undefined)).toBe(50);
    expect(h2hHomeScore({ matches: 0, homeWins: 0, draws: 0, awayWins: 0 })).toBe(50);
    expect(h2hHomeScore({ matches: 10, homeWins: 6, draws: 2, awayWins: 2 })).toBe(70);
    expect(h2hDrawScore({ matches: 0, homeWins: 0, draws: 0, awayWins: 0 })).toBe(50);
    expect(h2hDrawScore({ matches: 10, homeWins: 6, draws: 2, awayWins: 2 })).toBe(20);
    expect(h2hRateScore(undefined)).toBe(50);
    expect(h2hRateScore(0.5)).toBe(50);
    expect(h2hRateScore(60)).toBe(60);
  });

  it('adjusts for weather, position and schedule', () => {
    expect(weatherSupportsGoals(undefined)).toBe(50);
    expect(weatherSupportsGoals({ precipitation: 1, windSpeed: 5, temperature: 20, condition: 'storm' })).toBeLessThan(50);
    expect(playerPositionScore('striker')).toBe(90);
    expect(playerPositionScore('central midfielder')).toBe(70);
    expect(playerPositionScore('defender')).toBe(35);
    expect(playerPositionScore('goalkeeper')).toBe(55);
    expect(playerPositionScore(undefined)).toBe(55);
  });

  it('bounds expected scorelines and motivation/schedule gaps', () => {
    expect(expectedScoreline(1.4, 2.6)).toBe('1-3');
    expect(expectedScoreline(9, -1)).toBe('6-0');
    expect(motivationDiffScore(undefined, 50)).toBe(50);
    expect(motivationDiffScore(90, 40)).toBe(75);
    expect(scheduleScore(undefined, 3)).toBe(50);
    expect(scheduleScore(7, 2)).toBe(75);
  });
});

describe('market shared helpers', () => {
  it('builds and reads factor scores', () => {
    const factors = buildFactors({ attack: 1, defense: 0.5 }, { attack: 70, defense: 40 });
    expect(factors).toEqual([
      { name: 'attack', score: 70, weight: 1 },
      { name: 'defense', score: 40, weight: 0.5 },
    ]);
    expect(scoreOf(factors, 'attack')).toBe(70);
    expect(scoreOf(factors, 'missing')).toBe(50);
  });

  it('applies neutral defaults for optional inputs', () => {
    expect(oddsOrDefault(undefined)).toBe(1.91);
    expect(oddsOrDefault(1)).toBe(1.91);
    expect(oddsOrDefault(2.5)).toBe(2.5);
    expect(valueOr(undefined, 5)).toBe(5);
    expect(valueOr(Number.NaN, 5)).toBe(5);
    expect(valueOr(3, 5)).toBe(3);
    // markets/shared also exposes its own goalRateScore; verify its neutral default.
    expect(sharedGoalRateScore(undefined, 4)).toBe(50);
    expect(sharedGoalRateScore(4, 4)).toBe(50);
  });

  it('maps direction to a three-way selection', () => {
    expect(threeWaySelection(60, 'Home', 'Away')).toBe('Home');
    expect(threeWaySelection(40, 'Home', 'Away')).toBe('Away');
    expect(threeWaySelection(50, 'Home', 'Away')).toBe('Draw');
  });

  it('scales injury impact and returns neutral when absent', () => {
    expect(injuriesImpact({})).toBe(50);
    expect(injuriesImpact({ injuries: { home: 0, away: 3, keyHome: 0, keyAway: 2 } })).toBeGreaterThan(50);
    expect(injuriesImpact({ injuries: { home: 4, away: 0, keyHome: 2, keyAway: 0 } })).toBeLessThan(50);
  });
});

describe('match result evidence scoring', () => {
  it('reports low evidence with no enrichment and high evidence with full data', () => {
    const empty = matchResultEvidenceScore({ fixture, enrichment: {}, weights: {} });
    const full = matchResultEvidenceScore({ fixture, enrichment: strongEnrichment, weights: {} });
    expect(empty).toBeLessThan(full);
    expect(full).toBeGreaterThan(0.5);
  });

  it('exposes a model probability derived from the Poisson model', () => {
    const score = scoreMatchResult({ fixture, enrichment: strongEnrichment, weights: DEFAULT_MARKET_WEIGHTS.MATCH_RESULT });
    expect(score.modelProbability).toBeGreaterThan(0);
    expect(score.modelProbability).toBeLessThan(1);
  });
});

describe('engine thresholds and best market', () => {
  it('applies the pick threshold inclusively at the boundary', () => {
    const outcome = scoreFixture(fixture, strongEnrichment);
    const exact = outcome.best.confidence;
    expect(filterPicks([outcome], exact)).toHaveLength(1);
    expect(filterPicks([outcome], exact + 0.01)).toHaveLength(0);
    expect(filterPicks([outcome], exact - 0.01)).toHaveLength(1);
  });

  it('returns the top market and handles an empty outcome list', () => {
    const outcome = scoreFixture(fixture, strongEnrichment);
    expect(bestMarketOf([])).toBeUndefined();
    expect(bestMarketOf([outcome])).toBe(outcome.best.market);
  });
});

describe('config seeds and validation', () => {
  it('accepts a complete market-weight map', () => {
    const validated = validateConfigUpdate('market_weights', DEFAULT_MARKET_WEIGHTS);
    expect(validated).toEqual(DEFAULT_MARKET_WEIGHTS);
  });

  it('rejects market weights with a missing or empty market', () => {
    const missing = { ...DEFAULT_MARKET_WEIGHTS } as Record<string, unknown>;
    delete missing.PLAYER_SCORER;
    expect(() => validateConfigUpdate('market_weights', missing)).toThrow(/PLAYER_SCORER/);

    const empties = { ...DEFAULT_MARKET_WEIGHTS, MATCH_RESULT: {} };
    expect(() => validateConfigUpdate('market_weights', empties)).toThrow(/MATCH_RESULT/);
  });

  it('rejects market weights whose total is not positive', () => {
    const zeroed = { ...DEFAULT_MARKET_WEIGHTS, MATCH_RESULT: { homeXgVsAwayXg: 0 } };
    expect(() => validateConfigUpdate('market_weights', zeroed)).toThrow(/positive total/);
  });

  it('validates data source priorities uniquely', () => {
    expect(validateConfigUpdate('data_source_priorities', ['api-football'])).toEqual(['api-football']);
    expect(() => validateConfigUpdate('data_source_priorities', ['api-football', 'api-football']))
      .toThrow(/duplicates/);
  });

  it('exposes deterministic seed values and descriptions', () => {
    expect(typeof configValueForSeed('confidence_threshold')).toBe('number');
    expect(configValueForSeed('market_weights')).toBe(DEFAULT_MARKET_WEIGHTS);
    expect(Array.isArray(configValueForSeed('data_source_priorities'))).toBe(true);
    expect(configDescriptionForSeed('confidence_threshold')).toContain('model score');
    expect(configDescriptionForSeed('market_weights')).toContain('weights');
    expect(configDescriptionForSeed('data_source_priorities')).toContain('order');
  });
});
