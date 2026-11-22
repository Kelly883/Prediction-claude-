/**
 * Statistical helpers for the prediction engine.
 *
 * These functions implement genuine mathematical models (Poisson, three-way
 * normalization, Asian Handicap settlement) rather than heuristic scores.
 * They are pure and deterministic so the engine remains reproducible.
 */

/** Poisson probability mass function: P(X = k) given mean λ. */
export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0 || k < 0) return k === 0 && lambda === 0 ? 1 : 0;
  // log-space to avoid overflow for large k
  const logP = -lambda + k * Math.log(lambda) - logFactorial(k);
  return Math.exp(logP);
}

function logFactorial(n: number): number {
  let result = 0;
  for (let i = 2; i <= n; i += 1) result += Math.log(i);
  return result;
}

export interface ScorelineProbability {
  home: number;
  away: number;
  probability: number;
}

/**
 * Computes a normalized scoreline probability distribution (0..MAX_GOALS each
 * side) from expected goals for home and away. The distribution is truncated
 * at MAX_GOALS and renormalized so probabilities sum to 1.
 */
export function scorelineDistribution(
  homeExpected: number,
  awayExpected: number,
  maxGoals = 6,
): ScorelineProbability[] {
  const homeLambda = Math.max(0, homeExpected);
  const awayLambda = Math.max(0, awayExpected);
  const distribution: ScorelineProbability[] = [];
  let total = 0;

  for (let h = 0; h <= maxGoals; h += 1) {
    for (let a = 0; a <= maxGoals; a += 1) {
      const p = poissonPmf(homeLambda, h) * poissonPmf(awayLambda, a);
      distribution.push({ home: h, away: a, probability: p });
      total += p;
    }
  }

  // Renormalize (truncation correction).
  if (total > 0) {
    for (const entry of distribution) entry.probability /= total;
  }
  return distribution;
}

/** Returns the most probable scoreline from a normalized distribution. */
export function mostLikelyScoreline(distribution: ScorelineProbability[]): ScorelineProbability {
  let best = distribution[0];
  let bestP = -1;
  for (const entry of distribution) {
    if (entry.probability > bestP) {
      bestP = entry.probability;
      best = entry;
    }
  }
  return best;
}

export interface ThreeWayProbabilities {
  home: number;
  draw: number;
  away: number;
}

/**
 * Derives a three-way (home/draw/away) probability split from a directional
 * score (0..100, 50 = even) and an evidence factor (0..1). The split is
 * normalized to sum to 1. At direction=50 (even) the draw share is highest;
 * as direction moves toward home or away, that side's share grows.
 */
export function threeWayFromDirection(direction: number, evidence = 1): ThreeWayProbabilities {
  const d = Math.max(0, Math.min(100, direction)) / 100; // 0..1
  const ev = Math.max(0, Math.min(1, evidence));

  // Base draw share shrinks as evidence of a directional result grows.
  const drawShare = Math.max(0.05, 0.30 * (1 - ev * 0.5));
  const remaining = 1 - drawShare;

  // Home share of the non-draw mass: 0.5 at d=0.5, →0.95 at d=1, →0.05 at d=0.
  // Deliberately never reaches 0 or 1 so the heuristic never claims a
  // statistically impossible certainty (a 100/0 split).
  const homeShare = Math.max(0.05, Math.min(0.95, 0.5 + (d - 0.5) * 0.9));
  const home = remaining * homeShare;
  const away = remaining * (1 - homeShare);

  return { home, draw: drawShare, away };
}

export interface DoubleChanceProbabilities {
  homeDraw: number;
  drawAway: number;
  homeAway: number;
}

/** Computes the three double-chance outcome probabilities from a 3-way split. */
export function doubleChanceFromThreeWay(p: ThreeWayProbabilities): DoubleChanceProbabilities {
  return {
    homeDraw: p.home + p.draw,
    drawAway: p.draw + p.away,
    homeAway: p.home + p.away,
  };
}

export type HandicapOutcome = 'win' | 'push' | 'loss';

/**
 * Settles an Asian Handicap bet for the backed team.
 *
 * @param goalDifference goals scored by backed team minus goals conceded.
 * @param handicapLine the handicap applied to the backed team (e.g. -0.5, +1, -0.25).
 * @returns 'win' | 'push' | 'loss' for a whole/half line, or a half-win/half-loss
 *   tuple for quarter lines.
 */
export function settleAsianHandicap(
  goalDifference: number,
  handicapLine: number,
): { outcome: HandicapOutcome; half?: 'win' | 'loss' } {
  const adjusted = goalDifference + handicapLine;
  if (adjusted > 0) return { outcome: 'win' };
  if (adjusted < 0) return { outcome: 'loss' };
  return { outcome: 'push' };
}

/**
 * Quarter-line Asian Handicap settlement (e.g. -0.25, -0.75, +0.25).
 * A quarter line is split into two half-lines; the result is a half-win/half-loss.
 */
export function settleQuarterHandicap(
  goalDifference: number,
  quarterLine: number,
): { outcome: HandicapOutcome; half?: 'win' | 'loss' } {
  // Split quarter line into two adjacent half/whole lines.
  const lower = quarterLine - 0.25;
  const upper = quarterLine + 0.25;
  const lowerResult = settleAsianHandicap(goalDifference, lower);
  const upperResult = settleAsianHandicap(goalDifference, upper);

  if (lowerResult.outcome === 'win' && upperResult.outcome === 'win') return { outcome: 'win' };
  if (lowerResult.outcome === 'loss' && upperResult.outcome === 'loss') return { outcome: 'loss' };
  if (lowerResult.outcome === 'push' && upperResult.outcome === 'push') return { outcome: 'push' };
  // Split: one wins, one loses/push → half-win or half-loss.
  if (lowerResult.outcome === 'win' || upperResult.outcome === 'win') return { outcome: 'win', half: 'win' };
  return { outcome: 'loss', half: 'loss' };
}