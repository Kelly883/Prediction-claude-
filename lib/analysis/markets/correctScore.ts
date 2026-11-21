import type { MarketScore } from '@/types/analysis';
import { clamp, confidenceFromPropensity, evidenceScore, normalize, weightedScore } from '../utils/confidence';
import { expectedScoreline, goalRateScore, h2hRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildFactors, oddsOrDefault, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreCorrectScore(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeBase = valueOr(enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor, 1.4);
  const awayBase = valueOr(enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor, 1.1);
  const defenseDelta = ((valueOr(enrichment.awayStats?.goalsAgainst, 1.3) - valueOr(enrichment.homeStats?.goalsAgainst, 1.3)) / 2);
  const homeExpected = clamp(homeBase + defenseDelta, 0, 6);
  const awayExpected = clamp(awayBase - defenseDelta, 0, 6);
  const selection = expectedScoreline(homeExpected, awayExpected);
  const poisson = normalize(clamp(50 + (2.4 - Math.abs(homeExpected - 1.5) - Math.abs(awayExpected - 1.2)) * 18));
  const defense = goalRateScore(valueOr(enrichment.awayStats?.goalsAgainst, 1.3) + valueOr(enrichment.homeStats?.goalsAgainst, 1.3), 2.6);
  const factors = buildFactors(weights, {
    poisson,
    defense,
    h2hScores: h2hRateScore(enrichment.h2h?.over25Rate),
    weather: weatherSupportsGoals(enrichment.weather),
    homeXgVsAwayXg: poisson,
    h2h: h2hRateScore(enrichment.h2h?.over25Rate),
    form: defense,
    homeAdvantage: 60,
    injuries: 50,
    motivation: 50,
  });
  const propensity = weightedScore(factors);
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.homeStats?.goalsAgainst,
    enrichment.awayStats?.goalsAgainst,
    enrichment.h2h?.over25Rate,
    enrichment.weather?.precipitation,
  ]);
  return {
    market: 'CORRECT_SCORE',
    selection,
    odds: oddsOrDefault(enrichment.odds?.correctScore?.[selection]),
    confidence: evidence === 0 ? 50 : confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
