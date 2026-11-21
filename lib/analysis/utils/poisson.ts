/**
 * Poisson-based scoreline model.
 *
 * The engine previously used hand-tuned expressions that were *labelled*
 * "poisson" but were not probability distributions (see
 * docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md §E). This module implements a
 * genuine Poisson goal model: expected goals are derived from team attack /
 * defence rates, a full scoreline distribution is produced, normalised, and
 * used to derive Match Result, Double Chance and Asian Handicap outcomes.
 *
 * Everything here is a MODEL estimate, not a calibrated probability. Callers
 * must not present these figures as empirical win probabilities.
 */
import type { FixtureEnrichment } from '@/types/analysis';
import { clamp } from './confidence';

const DEFAULT_LEAGUE_GOALS = 2.6;
const HOME_ADVANTAGE = 1.1;
const MIN_EXPECTED_GOALS = 0.15;
const MAX_EXPECTED_GOALS = 5;
const DEFAULT_MAX_GOALS = 8;

export type ExpectedGoalSource = 'xg' | 'goals' | 'league';

export interface ExpectedGoals {
  home: number;
  away: number;
  source: ExpectedGoalSource;
}

export interface ScorelineProbability {
  home: number;
  away: number;
  probability: number;
}

export interface ScorelineModel {
  expected: ExpectedGoals;
  /** Scorelines sorted by descending probability; probabilities sum to 1. */
  scorelines: ScorelineProbability[];
  homeWin: number;
  draw: number;
  awayWin: number;
  homeOrDraw: number;
  awayOrDraw: number;
  homeOrAway: number;
}

function firstFinite(...values: Array<number | undefined>): number | undefined {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
}

/** Poisson probability mass function P(X = k). */
export function poissonPmf(k: number, lambda: number): number {
  if (!Number.isInteger(k) || k < 0) return 0;
  if (!Number.isFinite(lambda) || lambda < 0) return 0;
  let factorial = 1;
  for (let i = 2; i <= k; i += 1) factorial *= i;
  return (Math.exp(-lambda) * Math.pow(lambda, k)) / factorial;
}

/**
 * Derive expected goals for each side from attack/defence rates (xG preferred,
 * goals as fallback, league average as last resort). Missing data falls back to
 * the league average so the model degrades gracefully rather than throwing.
 */
export function expectedGoals(enrichment: FixtureEnrichment): ExpectedGoals {
  const leagueAverage = firstFinite(enrichment.leagueAvgGoals) ?? DEFAULT_LEAGUE_GOALS;
  const perTeam = clamp(leagueAverage / 2, 0.2, 4);

  const homeAttackXg = firstFinite(enrichment.homeStats?.xgFor);
  const awayAttackXg = firstFinite(enrichment.awayStats?.xgFor);
  const homeAttackGoals = firstFinite(enrichment.homeStats?.goalsFor);
  const awayAttackGoals = firstFinite(enrichment.awayStats?.goalsFor);

  const homeAttack = firstFinite(homeAttackXg, homeAttackGoals) ?? perTeam;
  const awayAttack = firstFinite(awayAttackXg, awayAttackGoals) ?? perTeam;
  const homeDefence = firstFinite(enrichment.homeStats?.xgAgainst, enrichment.homeStats?.goalsAgainst) ?? perTeam;
  const awayDefence = firstFinite(enrichment.awayStats?.xgAgainst, enrichment.awayStats?.goalsAgainst) ?? perTeam;

  const home = clamp(((homeAttack * awayDefence) / perTeam) * HOME_ADVANTAGE, MIN_EXPECTED_GOALS, MAX_EXPECTED_GOALS);
  const away = clamp((awayAttack * homeDefence) / perTeam, MIN_EXPECTED_GOALS, MAX_EXPECTED_GOALS);

  const source: ExpectedGoalSource =
    homeAttackXg !== undefined || awayAttackXg !== undefined
      ? 'xg'
      : homeAttackGoals !== undefined || awayAttackGoals !== undefined
        ? 'goals'
        : 'league';

  return { home, away, source };
}

/** Build the normalised Poisson scoreline distribution and derived 1X2 markets. */
export function buildScorelineModel(enrichment: FixtureEnrichment, maxGoals = DEFAULT_MAX_GOALS): ScorelineModel {
  const expected = expectedGoals(enrichment);
  const raw: ScorelineProbability[] = [];
  let total = 0;

  for (let home = 0; home <= maxGoals; home += 1) {
    const homePmf = poissonPmf(home, expected.home);
    for (let away = 0; away <= maxGoals; away += 1) {
      const probability = homePmf * poissonPmf(away, expected.away);
      raw.push({ home, away, probability });
      total += probability;
    }
  }

  const scorelines = total > 0
    ? raw.map((entry) => ({ ...entry, probability: entry.probability / total }))
    : raw;
  scorelines.sort((left, right) => right.probability - left.probability);

  let homeWin = 0;
  let draw = 0;
  let awayWin = 0;
  for (const entry of scorelines) {
    if (entry.home > entry.away) homeWin += entry.probability;
    else if (entry.home === entry.away) draw += entry.probability;
    else awayWin += entry.probability;
  }

  return {
    expected,
    scorelines,
    homeWin,
    draw,
    awayWin,
    homeOrDraw: homeWin + draw,
    awayOrDraw: awayWin + draw,
    homeOrAway: homeWin + awayWin,
  };
}

export function mostLikelyScoreline(model: ScorelineModel): ScorelineProbability {
  return model.scorelines[0] ?? { home: 0, away: 0, probability: 0 };
}

/**
 * Fair Asian handicap line (home perspective) — the 0.25-grained line at which
 * the home side's expected settlement is closest to zero. Used only as a
 * fallback when no real bookmaker line was captured; the Asian Handicap market
 * declines to pick unless an actual line is available.
 */
export function fairHandicapLine(model: ScorelineModel): number {
  let best = 0;
  let bestAbs = Infinity;
  for (let quarter = -16; quarter <= 16; quarter += 1) {
    const line = quarter / 4;
    const abs = Math.abs(handicapCoverage(model, 'home', line).edge);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = line;
    }
  }
  return best;
}

export type AsianHandicapOutcome = 'win' | 'half-win' | 'push' | 'half-loss' | 'loss';

const LINE_OUTCOME_UNITS: Record<'win' | 'push' | 'loss', number> = { win: 2, push: 1, loss: 0 };

/** Expected settlement value per unit stake at even odds (win +1 … loss -1). */
const OUTCOME_SETTLEMENT: Record<AsianHandicapOutcome, number> = {
  win: 1,
  'half-win': 0.5,
  push: 0,
  'half-loss': -0.5,
  loss: -1,
};

function settleLine(teamGoals: number, opponentGoals: number, line: number): 'win' | 'push' | 'loss' {
  const margin = teamGoals + line - opponentGoals;
  if (margin > 1e-9) return 'win';
  if (margin < -1e-9) return 'loss';
  return 'push';
}

/**
 * Settle an Asian handicap bet for a team given the actual scoreline and the
 * handicap line applied to that team (negative = the team is giving a start).
 * Quarter lines (…, ±0.25, ±0.75, …) are split into their two neighbouring
 * whole/half lines to produce push, half-win and half-loss outcomes.
 */
export function settleAsianHandicap(teamGoals: number, opponentGoals: number, line: number): AsianHandicapOutcome {
  if (!Number.isFinite(line)) return 'push';
  const doubled = line * 2;
  if (Math.abs(doubled - Math.round(doubled)) > 1e-9) {
    const lower = settleLine(teamGoals, opponentGoals, line - 0.25);
    const upper = settleLine(teamGoals, opponentGoals, line + 0.25);
    if ((lower === 'win' && upper === 'loss') || (lower === 'loss' && upper === 'win')) return 'push';
    const units = LINE_OUTCOME_UNITS[lower] + LINE_OUTCOME_UNITS[upper];
    if (units >= 4) return 'win';
    if (units === 3) return 'half-win';
    if (units === 2) return 'push';
    if (units === 1) return 'half-loss';
    return 'loss';
  }
  return settleLine(teamGoals, opponentGoals, line);
}

export interface HandicapCoverage {
  /** Expected settlement value per unit at even odds (>0 means the line favours this side). */
  edge: number;
  win: number;
  halfWin: number;
  push: number;
  halfLoss: number;
  loss: number;
}

/** Aggregate the scoreline distribution against a handicap line for one side. */
export function handicapCoverage(
  model: ScorelineModel,
  side: 'home' | 'away',
  line: number,
): HandicapCoverage {
  const coverage: HandicapCoverage = { edge: 0, win: 0, halfWin: 0, push: 0, halfLoss: 0, loss: 0 };
  for (const entry of model.scorelines) {
    const teamGoals = side === 'home' ? entry.home : entry.away;
    const opponentGoals = side === 'home' ? entry.away : entry.home;
    const outcome = settleAsianHandicap(teamGoals, opponentGoals, line);
    coverage.edge += entry.probability * OUTCOME_SETTLEMENT[outcome];
    if (outcome === 'win') coverage.win += entry.probability;
    else if (outcome === 'half-win') coverage.halfWin += entry.probability;
    else if (outcome === 'push') coverage.push += entry.probability;
    else if (outcome === 'half-loss') coverage.halfLoss += entry.probability;
    else coverage.loss += entry.probability;
  }
  return coverage;
}

/** Probability the side avoids a loss (win, half-win, or push). */
export function coverageSafety(coverage: HandicapCoverage): number {
  return clamp(coverage.win + coverage.halfWin + coverage.push, 0, 1);
}
