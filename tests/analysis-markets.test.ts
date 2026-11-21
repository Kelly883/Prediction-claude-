import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_WEIGHTS } from '@/lib/analysis/config';
import { scoreAsianHandicap } from '@/lib/analysis/markets/asianHandicap';
import { scoreCorrectScore } from '@/lib/analysis/markets/correctScore';
import { scoreDoubleChance } from '@/lib/analysis/markets/doubleChance';
import {
  buildScorelineModel,
  handicapCoverage,
  mostLikelyScoreline,
  poissonPmf,
  settleAsianHandicap,
} from '@/lib/analysis/utils/poisson';
import type { FixtureEnrichment, MarketType } from '@/types/analysis';
import type { MarketContext } from '@/lib/analysis/markets/shared';

const fixture = { homeTeam: 'Home FC', awayTeam: 'Away FC' };

function context(market: MarketType, enrichment: FixtureEnrichment): MarketContext {
  return { fixture, enrichment, weights: DEFAULT_MARKET_WEIGHTS[market] };
}

function enrichment(overrides: Partial<FixtureEnrichment> = {}): FixtureEnrichment {
  return {
    homeStats: { xgFor: 2.1, xgAgainst: 0.7, goalsFor: 2.0, goalsAgainst: 0.8, form: ['W', 'W', 'D', 'W', 'W'] },
    awayStats: { xgFor: 0.8, xgAgainst: 1.6, goalsFor: 0.9, goalsAgainst: 1.5, form: ['L', 'D', 'L', 'W', 'L'] },
    h2h: { matches: 10, homeWins: 6, draws: 2, awayWins: 2, bttsRate: 0.4, over25Rate: 0.5 },
    injuries: { home: 1, away: 2, keyHome: 0, keyAway: 1 },
    odds: {
      matchResult: { home: 1.7, draw: 3.6, away: 4.5 },
      doubleChance: { homeDraw: 1.25, drawAway: 1.9, homeAway: 1.35 },
      correctScore: { '2-0': 7.5, '2-1': 8.0 },
      asianHandicap: { home: 1.9, away: 1.95, line: -0.5 },
    },
    weather: { precipitation: 0, windSpeed: 3, temperature: 17, condition: 'clear' },
    leagueAvgGoals: 2.7,
    motivation: { home: 70, away: 60 },
    schedule: { homeRestDays: 4, awayRestDays: 3 },
    referee: { cardsPerGame: 4.2 },
    ...overrides,
  };
}

describe('poisson utilities', () => {
  it('produces a valid Poisson probability mass function', () => {
    let total = 0;
    for (let k = 0; k <= 30; k += 1) total += poissonPmf(k, 2);
    expect(total).toBeCloseTo(1, 6);
    expect(poissonPmf(0, 0)).toBe(1);
    expect(poissonPmf(1, 0)).toBe(0);
    expect(poissonPmf(2, -1)).toBe(0);
  });

  it('normalises the scoreline distribution and derives consistent 1X2 markets', () => {
    const model = buildScorelineModel(enrichment());
    const distributionTotal = model.scorelines.reduce((sum, entry) => sum + entry.probability, 0);
    expect(distributionTotal).toBeCloseTo(1, 6);
    expect(model.homeWin + model.draw + model.awayWin).toBeCloseTo(1, 6);
    expect(model.homeOrDraw).toBeCloseTo(model.homeWin + model.draw, 6);
    expect(model.awayOrDraw).toBeCloseTo(model.awayWin + model.draw, 6);
    expect(model.homeOrAway).toBeCloseTo(model.homeWin + model.awayWin, 6);
    // mathematical consistency: the three double-chance options always sum to 2
    expect(model.homeOrDraw + model.awayOrDraw + model.homeOrAway).toBeCloseTo(2, 6);
  });

  it('orders scorelines by descending probability', () => {
    const model = buildScorelineModel(enrichment());
    for (let i = 1; i < model.scorelines.length; i += 1) {
      expect(model.scorelines[i - 1].probability).toBeGreaterThanOrEqual(model.scorelines[i].probability);
    }
  });

  it('falls back to league averages when xG and goals are missing', () => {
    const model = buildScorelineModel({ leagueAvgGoals: 2.6 });
    expect(model.expected.source).toBe('league');
    expect(model.expected.home).toBeGreaterThan(0);
    expect(model.expected.away).toBeGreaterThan(0);
    expect(model.scorelines.length).toBeGreaterThan(0);
  });
});

describe('asian handicap settlement', () => {
  it('settles whole and half lines', () => {
    expect(settleAsianHandicap(2, 1, 0)).toBe('win');
    expect(settleAsianHandicap(1, 1, 0)).toBe('push');
    expect(settleAsianHandicap(1, 1, -0.5)).toBe('loss');
    expect(settleAsianHandicap(2, 1, -0.5)).toBe('win');
    expect(settleAsianHandicap(2, 1, -1)).toBe('push');
  });

  it('settles quarter lines as half-win / half-loss', () => {
    expect(settleAsianHandicap(1, 1, -0.25)).toBe('half-loss');
    expect(settleAsianHandicap(1, 1, 0.25)).toBe('half-win');
    expect(settleAsianHandicap(2, 1, -1.25)).toBe('half-loss');
    expect(settleAsianHandicap(3, 1, -1.25)).toBe('win');
    expect(settleAsianHandicap(1, 2, 1.25)).toBe('half-win');
  });

  it('aggregates coverage with correct edge accounting', () => {
    const model = buildScorelineModel(enrichment({
      homeStats: { xgFor: 2.0, xgAgainst: 1.0, goalsFor: 2.0, goalsAgainst: 1.0 },
      awayStats: { xgFor: 1.0, xgAgainst: 2.0, goalsFor: 1.0, goalsAgainst: 2.0 },
      leagueAvgGoals: 2.6,
    }));
    const coverage = handicapCoverage(model, 'home', -0.5);
    expect(coverage.win + coverage.halfWin + coverage.push + coverage.halfLoss + coverage.loss).toBeCloseTo(1, 6);
    // edge = win + 0.5·halfWin − 0.5·halfLoss − loss
    const expectedEdge = coverage.win + 0.5 * coverage.halfWin - 0.5 * coverage.halfLoss - coverage.loss;
    expect(coverage.edge).toBeCloseTo(expectedEdge, 9);
    expect(coverage.edge).toBeGreaterThan(0);
  });
});

describe('double chance market', () => {
  it('selects one of the three supported double-chance options', () => {
    const score = scoreDoubleChance(context('DOUBLE_CHANCE', enrichment()));
    expect([
      'Home FC or Draw',
      'Away FC or Draw',
      'Home FC or Away FC',
    ]).toContain(score.selection);
  });

  it('derives its probability from match result probabilities and stays consistent', () => {
    const model = buildScorelineModel(enrichment());
    const score = scoreDoubleChance(context('DOUBLE_CHANCE', enrichment()));
    expect(score.modelProbability).toBeCloseTo(
      Math.max(model.homeOrDraw, model.awayOrDraw, model.homeOrAway),
      6,
    );
    expect(score.confidence).toBeGreaterThanOrEqual(0);
    expect(score.confidence).toBeLessThanOrEqual(100);
  });

  it('picks Home or Draw for a dominant home side', () => {
    const score = scoreDoubleChance(context('DOUBLE_CHANCE', enrichment({
      homeStats: { xgFor: 2.8, xgAgainst: 0.4, goalsFor: 2.9, goalsAgainst: 0.5 },
      awayStats: { xgFor: 0.4, xgAgainst: 2.4, goalsFor: 0.4, goalsAgainst: 2.5 },
      leagueAvgGoals: 3.0,
    })));
    expect(score.selection).toBe('Home FC or Draw');
  });

  it('can select the Home or Away option when a draw is least likely', () => {
    const score = scoreDoubleChance(context('DOUBLE_CHANCE', enrichment({
      homeStats: { xgFor: 1.7, xgAgainst: 1.7, goalsFor: 1.7, goalsAgainst: 1.7 },
      awayStats: { xgFor: 1.7, xgAgainst: 1.7, goalsFor: 1.7, goalsAgainst: 1.7 },
      leagueAvgGoals: 2.9,
    })));
    expect(score.selection).toBe('Home FC or Away FC');
  });
});

describe('correct score market', () => {
  it('selects the most probable scoreline from the Poisson distribution', () => {
    const model = buildScorelineModel(enrichment());
    const score = scoreCorrectScore(context('CORRECT_SCORE', enrichment()));
    const mostLikely = mostLikelyScoreline(model);
    expect(score.selection).toBe(`${mostLikely.home}-${mostLikely.away}`);
    expect(score.selection).toMatch(/^\d+-\d+$/);
    expect(score.modelProbability).toBeCloseTo(mostLikely.probability, 9);
  });

  it('handles missing xG data safely', () => {
    const score = scoreCorrectScore(context('CORRECT_SCORE', {}));
    expect(score.selection).toMatch(/^\d+-\d+$/);
    expect(score.confidence).toBeLessThanOrEqual(60);
    expect(score.confidence).toBeGreaterThanOrEqual(0);
  });
});

describe('asian handicap market', () => {
  it('uses the actual captured line instead of a hard-coded -0.5', () => {
    const score = scoreAsianHandicap(context('ASIAN_HANDICAP', enrichment({
      homeStats: { xgFor: 2.6, xgAgainst: 0.5, goalsFor: 2.7, goalsAgainst: 0.5 },
      awayStats: { xgFor: 0.5, xgAgainst: 2.4, goalsFor: 0.5, goalsAgainst: 2.5 },
      leagueAvgGoals: 3.0,
      odds: {
        asianHandicap: { home: 1.8, away: 2.0, line: -1 },
      },
    })));
    expect(score.selection).toBe('Home FC -1');
    expect(score.selection).not.toContain('-0.5');
    expect(score.confidence).toBeGreaterThan(50);
    expect(score.modelProbability).toBeGreaterThan(0.5);
  });

  it('declines to pick when no real line was captured', () => {
    const score = scoreAsianHandicap(context('ASIAN_HANDICAP', enrichment({
      odds: { matchResult: { home: 1.7, draw: 3.6, away: 4.5 } },
    })));
    expect(score.selection).toBe('No handicap');
    expect(score.confidence).toBe(50);
    expect(score.modelProbability).toBeUndefined();
  });
});
