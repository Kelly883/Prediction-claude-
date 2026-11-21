import type { MarketScore } from '@/types/analysis';
import { confidenceFromPropensity, evidenceScore, weightedScore } from '../utils/confidence';
import { goalRateScore, h2hRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildFactors, oddsOrDefault, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreOverUnder(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeXg = enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor;
  const awayXg = enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor;
  const recentTotals = (valueOr(homeXg, 0) + valueOr(awayXg, 0)) || undefined;
  const factors = buildFactors(weights, {
    leagueAvgGoals: goalRateScore(enrichment.leagueAvgGoals, 2.5),
    teamXg: goalRateScore(recentTotals, 5),
    recentTotals: goalRateScore(recentTotals, 5),
    pace: valueOr(enrichment.pace, 50),
    weather: weatherSupportsGoals(enrichment.weather),
    h2hOver: h2hRateScore(enrichment.h2h?.over25Rate),
  });
  const propensity = weightedScore(factors);
  const evidence = evidenceScore([
    enrichment.leagueAvgGoals,
    homeXg,
    awayXg,
    enrichment.pace,
    enrichment.weather?.precipitation,
    enrichment.h2h?.over25Rate,
  ]);
  const selection = propensity >= 55 ? 'Over 2.5' : 'Under 2.5';
  return {
    market: 'OVER_UNDER_2_5',
    selection,
    odds: oddsOrDefault(selection === 'Over 2.5' ? enrichment.odds?.overUnder25?.over : enrichment.odds?.overUnder25?.under),
    confidence: confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
