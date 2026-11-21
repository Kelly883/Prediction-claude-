import { describe, expect, it } from 'vitest';
import { DEFAULT_MARKET_WEIGHTS } from '@/lib/analysis/config';
import { scoreFixture } from '@/lib/analysis/engine';
import { scoreAsianHandicap } from '@/lib/analysis/markets/asianHandicap';
import { scoreBtts } from '@/lib/analysis/markets/btts';
import { scoreFirstHalfResult } from '@/lib/analysis/markets/firstHalfResult';
import { scoreMatchResult } from '@/lib/analysis/markets/matchResult';
import { scoreOverUnder } from '@/lib/analysis/markets/overUnder';
import { scorePlayerScorer } from '@/lib/analysis/markets/playerScorer';
import { matchResultDirection } from '@/lib/analysis/markets/shared';
import {
  clamp,
  normalize,
  round2,
  weightedScore,
} from '@/lib/analysis/utils/confidence';
import {
  h2hDrawScore,
  h2hHomeScore,
  parseForm,
  weatherSupportsGoals,
} from '@/lib/analysis/utils/normalization';
import type { MarketContext } from '@/lib/analysis/markets/shared';
import type { AnalysisSettings, Fixture, FixtureEnrichment, MarketType } from '@/types/analysis';

const fixture: Pick<Fixture, 'homeTeam' | 'awayTeam'> = { homeTeam: 'Home FC', awayTeam: 'Away FC' };

function context(market: MarketType, enrichment: FixtureEnrichment): MarketContext {
  return { fixture, enrichment, weights: DEFAULT_MARKET_WEIGHTS[market] };
}

describe('market branch coverage', () => {
  it('selects the No side of BTTS for a low-scoring match', () => {
    const score = scoreBtts(context('BTTS', {
      homeStats: { xgFor: 0.6, xgAgainst: 0.5, goalsFor: 0.5, goalsAgainst: 0.4, form: ['L', 'L', 'L'] },
      awayStats: { xgFor: 0.5, xgAgainst: 0.6, goalsFor: 0.4, goalsAgainst: 0.5, form: ['L', 'D', 'L'] },
      h2h: { matches: 10, homeWins: 3, draws: 4, awayWins: 3, bttsRate: 0.1, over25Rate: 0.2 },
      odds: { btts: { yes: 2.5, no: 1.5 } },
      leagueAvgGoals: 1.8,
      weather: { precipitation: 2, windSpeed: 8, temperature: 10, condition: 'heavy rain' },
    }));
    expect(score.selection).toBe('No');
    expect(score.odds).toBe(1.5);
  });

  it('selects the Under side of Over/Under for a low-scoring match', () => {
    const score = scoreOverUnder(context('OVER_UNDER_2_5', {
      homeStats: { xgFor: 0.6, xgAgainst: 0.5, goalsFor: 0.5, goalsAgainst: 0.4 },
      awayStats: { xgFor: 0.5, xgAgainst: 0.6, goalsFor: 0.4, goalsAgainst: 0.5 },
      h2h: { matches: 10, homeWins: 3, draws: 4, awayWins: 3, bttsRate: 0.1, over25Rate: 0.2 },
      odds: { overUnder25: { over: 2.4, under: 1.55 } },
      leagueAvgGoals: 1.8,
      weather: { precipitation: 2, windSpeed: 8, temperature: 10, condition: 'heavy rain' },
    }));
    expect(score.selection).toBe('Under 2.5');
    expect(score.odds).toBe(1.55);
  });

  it('returns an unavailable player-scorer market when no players are known', () => {
    const score = scorePlayerScorer(context('PLAYER_SCORER', { players: [] }));
    expect(score.selection).toBe('Unavailable');
    expect(score.confidence).toBe(50);
  });

  it('ranks multiple players and handles non-penalty takers', () => {
    const score = scorePlayerScorer(context('PLAYER_SCORER', {
      awayStats: { goalsAgainst: 1.4 },
      odds: { playerScorer: { Bench: 9.0, Striker: 3.5 } },
      players: [
        { name: 'Striker', goals: 12, minutes: 900, penalties: 3, position: 'forward' },
        { name: 'Bench', goals: 0, minutes: 90, penalties: 0, position: 'defender' },
      ],
    }));
    expect(score.selection).toBe('Striker');
    expect(score.odds).toBe(3.5);
  });

  it('defaults first-half probabilities from xG and h2h when explicit half data is absent', () => {
    const score = scoreFirstHalfResult(context('FIRST_HALF_RESULT', {
      homeStats: { xgFor: 2.6, xgAgainst: 0.5, goalsFor: 2.7, goalsAgainst: 0.5, form: ['W', 'W', 'W'] },
      awayStats: { xgFor: 0.5, xgAgainst: 2.4, goalsFor: 0.5, goalsAgainst: 2.5, form: ['L', 'L', 'L'] },
      h2h: { matches: 10, homeWins: 8, draws: 1, awayWins: 1, firstHalfHomeWins: 5, firstHalfDraws: 2 },
      motivation: { home: 90, away: 30 },
      odds: { firstHalfResult: { home: 1.9, draw: 3.2, away: 4.0 } },
    }));
    expect(score.selection).toBe('Home FC');
    expect(score.odds).toBe(1.9);
  });

  it('selects the away side of the first-half market and the draw when data is missing', () => {
    const away = scoreFirstHalfResult(context('FIRST_HALF_RESULT', {
      homeStats: { xgFor: 0.4, xgAgainst: 2.4, goalsFor: 0.4, goalsAgainst: 2.5, form: ['L', 'L', 'L'], firstHalfGoalsFor: 0.1 },
      awayStats: { xgFor: 2.6, xgAgainst: 0.4, goalsFor: 2.7, goalsAgainst: 0.5, form: ['W', 'W', 'W'], firstHalfGoalsFor: 1.6 },
      h2h: { matches: 10, homeWins: 1, draws: 1, awayWins: 8, firstHalfHomeWins: 1, firstHalfDraws: 1 },
      motivation: { home: 30, away: 90 },
      odds: { firstHalfResult: { home: 1.9, draw: 3.2, away: 4.0 } },
    }));
    expect(away.selection).toBe('Away FC');
    expect(away.odds).toBe(4.0);

    const empty = scoreFirstHalfResult(context('FIRST_HALF_RESULT', {}));
    expect(empty.selection).toBe('Draw');
  });

  it('selects away and draw match-result sides and exposes their Poisson probability', () => {
    const away = scoreMatchResult(context('MATCH_RESULT', {
      homeStats: { xgFor: 0.5, xgAgainst: 2.4, goalsFor: 0.5, goalsAgainst: 2.5, form: ['L', 'L', 'L'] },
      awayStats: { xgFor: 2.5, xgAgainst: 0.5, goalsFor: 2.6, goalsAgainst: 0.5, form: ['W', 'W', 'W'] },
      h2h: { matches: 10, homeWins: 1, draws: 1, awayWins: 8 },
      motivation: { home: 30, away: 90 },
      odds: { matchResult: { home: 6.0, draw: 4.0, away: 1.4 } },
    }));
    expect(away.selection).toBe('Away FC');
    expect(away.odds).toBe(1.4);
    expect(away.modelProbability).toBeGreaterThan(0);

    const draw = scoreMatchResult(context('MATCH_RESULT', {
      homeStats: { xgFor: 1.5, xgAgainst: 1.5, goalsFor: 1.5, goalsAgainst: 1.5, form: ['W', 'D', 'L'] },
      awayStats: { xgFor: 1.5, xgAgainst: 1.5, goalsFor: 1.5, goalsAgainst: 1.5, form: ['W', 'D', 'L'] },
      h2h: { matches: 10, homeWins: 3, draws: 4, awayWins: 3 },
      injuries: { home: 1, away: 1, keyHome: 0, keyAway: 0 },
      motivation: { home: 60, away: 60 },
      odds: { matchResult: { home: 2.6, draw: 3.1, away: 2.7 } },
    }));
    expect(draw.selection).toBe('Draw');
    expect(draw.odds).toBe(3.1);
  });

  it('formats zero and positive handicap lines and can pick the away side', () => {
    const level = scoreAsianHandicap(context('ASIAN_HANDICAP', {
      homeStats: { xgFor: 2.6, xgAgainst: 0.5, goalsFor: 2.7, goalsAgainst: 0.5 },
      awayStats: { xgFor: 0.5, xgAgainst: 2.4, goalsFor: 0.5, goalsAgainst: 2.5 },
      leagueAvgGoals: 3.0,
      odds: { asianHandicap: { home: 1.9, away: 1.95, line: 0 } },
    }));
    expect(level.selection).toBe('Home FC 0');

    const away = scoreAsianHandicap(context('ASIAN_HANDICAP', {
      homeStats: { xgFor: 1.4, xgAgainst: 1.4, goalsFor: 1.4, goalsAgainst: 1.4 },
      awayStats: { xgFor: 1.4, xgAgainst: 1.4, goalsFor: 1.4, goalsAgainst: 1.4 },
      leagueAvgGoals: 2.8,
      odds: { asianHandicap: { home: 1.9, away: 1.95, line: -2 } },
    }));
    expect(away.selection).toBe('Away FC +2');
  });

  it('falls back to default weights when a market weight map is incomplete', () => {
    const settings: AnalysisSettings = {
      threshold: 75,
      marketWeights: {} as AnalysisSettings['marketWeights'],
      dataSourcePriorities: ['api-football'],
    };
    const outcome = scoreFixture(
      { id: 'fx', leagueCode: 'PL', leagueName: 'PL', kickoff: new Date(), homeTeam: 'H', awayTeam: 'A', source: 'api-football' },
      { homeStats: { xgFor: 2 }, awayStats: { xgFor: 0.5 } },
      settings,
    );
    expect(outcome.scores).toHaveLength(10);
  });
});

describe('numeric and normalization edge branches', () => {
  it('guards non-finite numeric inputs', () => {
    expect(normalize(Number.NaN)).toBe(0);
    expect(clamp(Number.POSITIVE_INFINITY, 5, 100)).toBe(5);
    expect(round2(Number.NaN)).toBe(0);
    expect(weightedScore([])).toBe(50);
    expect(weightedScore([{ name: 'x', score: 50, weight: 0 }])).toBe(50);
  });

  it('handles partial h2h, weather and form inputs', () => {
    expect(parseForm('xyz')).toBeUndefined();
    expect(h2hHomeScore({ matches: 5 } as never)).toBe(0);
    expect(h2hDrawScore({ matches: 5 } as never)).toBe(0);
    expect(weatherSupportsGoals({ condition: 'clear' } as never)).toBe(60);
  });

  it('returns a neutral direction when only one side has form data', () => {
    const { direction } = matchResultDirection(
      { homeStats: { form: ['W', 'W'] }, awayStats: { xgFor: 1 } },
      DEFAULT_MARKET_WEIGHTS.MATCH_RESULT,
    );
    expect(Number.isFinite(direction)).toBe(true);
  });
});
