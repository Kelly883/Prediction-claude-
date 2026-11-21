import type { FactorScore } from '@/types/analysis';

export function clamp(value: number, min = 0, max = 100): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function round2(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

export function normalize(value: number): number {
  return round2(clamp(value));
}

export function weightedScore(factors: FactorScore[]): number {
  const usable = factors.filter((factor) => Number.isFinite(factor.score) && Number.isFinite(factor.weight) && factor.weight > 0);
  const totalWeight = usable.reduce((sum, factor) => sum + factor.weight, 0);
  if (totalWeight <= 0) return 50;
  const weighted = usable.reduce((sum, factor) => sum + clamp(factor.score) * factor.weight, 0);
  return normalize(weighted / totalWeight);
}

export function contrastScore(left: number, right: number): number {
  return normalize(50 + (left - right) / 2);
}

export function strengthDiffScore(left: number, right: number): number {
  const denominator = Math.max(Math.abs(left) + Math.abs(right), 1);
  return normalize(50 + ((left - right) / denominator) * 100);
}

export function evidenceScore(values: Array<number | undefined | null>): number {
  const present = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  if (present.length === 0) return 0;
  return present.length / values.length;
}

export function confidenceFromDirection(direction: number, evidence: number): number {
  return normalize(50 + Math.abs(direction - 50) * clamp(evidence, 0, 1));
}

export function confidenceFromPropensity(propensity: number, evidence: number): number {
  return confidenceFromDirection(propensity, evidence);
}

export function topFactors(factors: FactorScore[], limit = 3): FactorScore[] {
  return [...factors]
    .sort((left, right) => right.weight * right.score - left.weight * left.score)
    .slice(0, limit)
    .map((factor) => ({ ...factor, score: round2(factor.score), weight: round2(factor.weight) }));
}

export function oddsToConfidence(odds: number | undefined): number {
  if (!odds || odds <= 1) return 50;
  return normalize((1 / odds) * 100);
}
