import type { MarketScore } from '@/types/analysis';
import { confidenceFromPropensity, evidenceScore, weightedScore } from '../utils/confidence';
import { goalRateScore, h2hRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildFactors, oddsOrNull } from './shared';
import type { MarketContext } from './shared';

export function scoreBtts(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeAttack = goalRateScore(enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor, 1.5);
  const awayAttack = goalRateScore(enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor, 1.5);
  const homeConceded = goalRateScore(enrichment.homeStats?.xgAgainst ?? enrichment.homeStats?.goalsAgainst, 1.5);
  const awayConceded = goalRateScore(enrichment.awayStats?.xgAgainst ?? enrichment.awayStats?.goalsAgainst, 1.5);
  const factors = buildFactors(weights, {
    bothScored: (homeAttack + awayAttack) / 2,
    bothConceded: (homeConceded + awayConceded) / 2,
    h2hBtts: h2hRateScore(enrichment.h2h?.bttsRate),
    defense: (homeConceded + awayConceded) / 2,
    weather: weatherSupportsGoals(enrichment.weather),
  });
  const propensity = weightedScore(factors);
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.homeStats?.xgAgainst ?? enrichment.homeStats?.goalsAgainst,
    enrichment.awayStats?.xgAgainst ?? enrichment.awayStats?.goalsAgainst,
    enrichment.h2h?.bttsRate,
    enrichment.weather?.precipitation,
  ]);
  const selection = propensity >= 55 ? 'Yes' : 'No';
  const odds = oddsOrNull(selection === 'Yes' ? enrichment.odds?.btts?.yes : enrichment.odds?.btts?.no);
  return {
    market: 'BTTS',
    selection,
    odds,
    oddsAvailable: odds !== null,
    confidence: confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
