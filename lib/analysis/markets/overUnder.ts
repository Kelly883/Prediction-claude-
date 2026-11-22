import type { MarketScore } from '@/types/analysis';
import { confidenceFromPropensity, evidenceScore, weightedScore } from '../utils/confidence';
import { goalRateScore, h2hRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildFactors, oddsOrNull, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreOverUnder(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeXg = enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor;
  const awayXg = enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor;
  // Only combine when BOTH sides are present: a missing side must not silently
  // become zero, which would understate the expected total (Stage 7).
  const recentTotals = homeXg !== undefined && awayXg !== undefined ? homeXg + awayXg : undefined;
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
  const odds = oddsOrNull(selection === 'Over 2.5' ? enrichment.odds?.overUnder25?.over : enrichment.odds?.overUnder25?.under);
  return {
    market: 'OVER_UNDER_2_5',
    selection,
    odds,
    oddsAvailable: odds !== null,
    confidence: confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
