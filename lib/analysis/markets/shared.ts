import type { FactorScore, FixtureEnrichment } from '@/types/analysis';
import { clamp, normalize, round2, weightedScore } from '../utils/confidence';
import { h2hHomeScore, motivationDiffScore, scheduleScore } from '../utils/normalization';
import type { MarketWeights } from '@/types/analysis';

export interface MarketContext {
  fixture: { homeTeam: string; awayTeam: string };
  enrichment: FixtureEnrichment;
  weights: MarketWeights[keyof MarketWeights];
}

export function buildFactors(weights: Record<string, number>, scores: Record<string, number>): FactorScore[] {
  return Object.entries(weights).map(([name, weight]) => ({
    name,
    score: normalize(scores[name] ?? 50),
    weight,
  }));
}

export function scoreOf(factors: FactorScore[], name: string): number {
  return factors.find((factor) => factor.name === name)?.score ?? 50;
}

export function directionFromFactors(factors: FactorScore[]): number {
  return weightedScore(factors);
}

export function threeWaySelection(direction: number, homeTeam: string, awayTeam: string): string {
  if (direction >= 58) return homeTeam;
  if (direction <= 42) return awayTeam;
  return 'Draw';
}

export function oddsOrDefault(value: number | undefined): number {
  return typeof value === 'number' && value > 1 ? round2(value) : 1.91;
}

export function valueOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function goalRateScore(value: number | undefined, reference: number): number {
  if (value === undefined) return 50;
  return normalize(50 + (value - reference) * 24);
}

export function injuriesImpact(enrichment: FixtureEnrichment): number {
  const home = enrichment.injuries?.home;
  const away = enrichment.injuries?.away;
  const keyHome = enrichment.injuries?.keyHome;
  const keyAway = enrichment.injuries?.keyAway;
  if (home === undefined && away === undefined && keyHome === undefined && keyAway === undefined) return 50;
  return normalize(50 + ((valueOr(away, 0) - valueOr(home, 0)) * 8) + ((valueOr(keyAway, 0) - valueOr(keyHome, 0)) * 5));
}

export function matchResultDirection(enrichment: FixtureEnrichment, weights: Record<string, number>): { direction: number; factors: FactorScore[] } {
  const homeXg = enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor;
  const awayXg = enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor;
  const factors = buildFactors(weights, {
    homeXgVsAwayXg: homeXg !== undefined && awayXg !== undefined ? strengthDiff(homeXg, awayXg) : 50,
    h2h: h2hHomeScore(enrichment.h2h),
    form: formContrast(enrichment),
    homeAdvantage: 62,
    injuries: injuriesImpact(enrichment),
    motivation: motivationDiffScore(enrichment.motivation?.home, enrichment.motivation?.away),
    schedule: scheduleScore(enrichment.schedule?.homeRestDays, enrichment.schedule?.awayRestDays),
    referee: 50,
    matchResultProbability: 50,
    h2hFirstHalf: 50,
  });
  return { direction: directionFromFactors(factors), factors };
}

function strengthDiff(left: number, right: number): number {
  const denominator = Math.max(Math.abs(left) + Math.abs(right), 1);
  return normalize(50 + ((left - right) / denominator) * 100);
}

function formContrast(enrichment: FixtureEnrichment): number {
  const homeForm = enrichment.homeStats?.form;
  const awayForm = enrichment.awayStats?.form;
  if (!homeForm || !awayForm) return 50;
  const homeScore = homeForm.reduce((sum, result) => sum + (result === 'W' ? 100 : result === 'D' ? 50 : 0), 0) / homeForm.length;
  const awayScore = awayForm.reduce((sum, result) => sum + (result === 'W' ? 100 : result === 'D' ? 50 : 0), 0) / awayForm.length;
  return normalize(clamp(50 + (homeScore - awayScore) / 2));
}
