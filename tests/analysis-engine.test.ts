import { describe, expect, it } from 'vitest';
import { filterPicks, scoreFixture } from '@/lib/analysis/engine';
import {
  DEFAULT_ANALYSIS_SETTINGS,
  LEAGUES,
  parseStoredConfigs,
  validateConfigUpdate,
} from '@/lib/analysis/config';
import {
  confidenceFromDirection,
  evidenceScore,
  normalize,
  topFactors,
  weightedScore,
} from '@/lib/analysis/utils/confidence';
import type { Fixture, FixtureEnrichment } from '@/types/analysis';

const fixture: Fixture = {
  id: 'fixture-1',
  leagueCode: 'PL',
  leagueName: 'English Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Home FC',
  awayTeam: 'Away FC',
  source: 'api-football',
};

const strongEnrichment: FixtureEnrichment = {
  homeStats: {
    xgFor: 2.6,
    xgAgainst: 0.4,
    goalsFor: 2.5,
    goalsAgainst: 0.5,
    form: ['W', 'W', 'W', 'W', 'W'],
    cornersFor: 7,
    cardsFor: 1,
    shotsFor: 18,
    firstHalfGoalsFor: 1.4,
  },
  awayStats: {
    xgFor: 0.5,
    xgAgainst: 2.2,
    goalsFor: 0.5,
    goalsAgainst: 2.3,
    form: ['L', 'L', 'L', 'L', 'L'],
    cornersFor: 3,
    cardsFor: 3,
    shotsFor: 7,
    firstHalfGoalsFor: 0.3,
  },
  h2h: {
    matches: 10,
    homeWins: 8,
    draws: 1,
    awayWins: 1,
    bttsRate: 0.2,
    over25Rate: 0.8,
  },
  injuries: { home: 0, away: 3, keyHome: 0, keyAway: 2 },
  odds: {
    matchResult: { home: 1.35, draw: 4.5, away: 8.2 },
    btts: { yes: 2.1, no: 1.7 },
    overUnder25: { over: 1.6, under: 2.3 },
    asianHandicap: { home: 1.75, away: 2.05 },
    doubleChance: { homeDraw: 1.18, drawAway: 3.4 },
    correctScore: { '2-1': 6.5 },
    firstHalfResult: { home: 1.9 },
    totalCorners: { over: 1.8 },
    totalCards: { over: 2.0 },
    playerScorer: { Striker: 4.2 },
  },
  weather: { precipitation: 0, windSpeed: 2, temperature: 20, condition: 'clear' },
  leagueAvgGoals: 3.2,
  leagueAvgCorners: 10,
  leagueAvgCards: 4.2,
  pace: 75,
  motivation: { home: 90, away: 40 },
  schedule: { homeRestDays: 7, awayRestDays: 2 },
  referee: { cardsPerGame: 4.8 },
  players: [{ name: 'Striker', goals: 20, minutes: 1800, penalties: 5, position: 'forward' }],
};

describe('confidence utilities', () => {
  it('clamps and rounds normalized values', () => {
    expect(normalize(120)).toBe(100);
    expect(normalize(-4)).toBe(0);
    expect(normalize(87.456)).toBe(87.46);
  });

  it('normalizes weights that do not sum to one', () => {
    expect(weightedScore([
      { name: 'a', score: 100, weight: 2 },
      { name: 'b', score: 50, weight: 2 },
    ])).toBe(75);
  });

  it('scales directional confidence by evidence', () => {
    expect(confidenceFromDirection(90, 1)).toBe(90);
    expect(confidenceFromDirection(90, 0)).toBe(50);
    expect(evidenceScore([1, undefined, 3])).toBeCloseTo(2 / 3, 2);
  });

  it('sorts top factors by weighted contribution', () => {
    const factors = [
      { name: 'low', score: 90, weight: 0.1 },
      { name: 'high', score: 80, weight: 0.6 },
      { name: 'mid', score: 70, weight: 0.3 },
    ];
    expect(topFactors(factors, 2).map((factor) => factor.name)).toEqual(['high', 'mid']);
  });
});

describe('analysis engine', () => {
  it('scores only the eligible markets and records eligibility for all ten', () => {
    const first = scoreFixture(fixture, strongEnrichment);
    const second = scoreFixture(fixture, strongEnrichment);

    // Eligibility is always recorded for every configured market, but only
    // eligible markets are scored (Stage 4 gate).
    expect(first.eligibility).toHaveLength(10);
    const eligible = first.eligibility.filter((decision) => decision.allowedToProceed).map((decision) => decision.market);
    expect(first.scores.map((score) => score.market)).toEqual(eligible);
    expect(new Set(first.scores.map((score) => score.market)).size).toBe(first.scores.length);
    // A market with no verified corner data stays restricted and is not scored.
    expect(eligible).not.toContain('TOTAL_CARDS');
    expect(first).toEqual(second);
    expect(first.topFactors).toHaveLength(3);
  });

  it('generates a high-confidence pick from strong evidence', () => {
    const outcome = scoreFixture(fixture, strongEnrichment);
    expect(outcome.best).toBeDefined();
    expect(outcome.best?.confidence).toBeGreaterThanOrEqual(75);
    expect(filterPicks([outcome], 75)).toHaveLength(1);
    expect(filterPicks([outcome], 99)).toHaveLength(0);
  });

  it('does not generate a pick without enrichment data', () => {
    const outcome = scoreFixture(fixture, {});
    // No eligible market => no best pick, never persisted.
    expect(outcome.best).toBeUndefined();
    expect(filterPicks([outcome], 75)).toHaveLength(0);
  });

  it('uses the configured threshold', () => {
    const outcome = scoreFixture(fixture, strongEnrichment);
    const settings = { ...DEFAULT_ANALYSIS_SETTINGS, threshold: 99 };
    expect(filterPicks([outcome], settings.threshold)).toHaveLength(0);
  });
});

describe('analysis configuration', () => {
  it('defines twenty enabled leagues by default', () => {
    expect(LEAGUES).toHaveLength(20);
    expect(new Set(LEAGUES.map((league) => league.leagueCode)).size).toBe(20);
    expect(LEAGUES.map((league) => league.leagueCode)).toContain('ECL');
  });

  it('validates config updates', () => {
    expect(validateConfigUpdate('confidence_threshold', 80)).toBe(80);
    expect(() => validateConfigUpdate('confidence_threshold', 20)).toThrow();
    expect(() => validateConfigUpdate('data_source_priorities', ['api-football', 'api-football'])).toThrow();
    expect(() => validateConfigUpdate('unknown_key', 1)).toThrow();
  });

  it('falls back to defaults for invalid stored configs', () => {
    const settings = parseStoredConfigs([
      { key: 'confidence_threshold', value: 500 },
      { key: 'market_weights', value: {} },
      { key: 'data_source_priorities', value: ['football-data'] },
    ]);
    expect(settings.threshold).toBe(75);
    expect(settings.dataSourcePriorities).toEqual(['football-data']);
    expect(settings.marketWeights.MATCH_RESULT.homeXgVsAwayXg).toBe(0.25);
  });
});
