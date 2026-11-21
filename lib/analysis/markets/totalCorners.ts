import type { MarketScore } from '@/types/analysis';
import { confidenceFromPropensity, evidenceScore, weightedScore } from '../utils/confidence';
import { goalRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildFactors, oddsOrDefault, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreTotalCorners(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeCorners = enrichment.homeStats?.cornersFor;
  const awayCorners = enrichment.awayStats?.cornersFor;
  const cornerTotal = homeCorners !== undefined && awayCorners !== undefined ? homeCorners + awayCorners : undefined;
  const homeShots = enrichment.homeStats?.shotsFor;
  const awayShots = enrichment.awayStats?.shotsFor;
  const shotTotal = homeShots !== undefined && awayShots !== undefined ? homeShots + awayShots : undefined;
  const factors = buildFactors(weights, {
    wingPlay: goalRateScore(shotTotal, 24),
    setPieces: goalRateScore(cornerTotal, 10),
    leagueAvg: goalRateScore(enrichment.leagueAvgCorners, 9.5),
    styleMatchup: goalRateScore((valueOr(homeShots, 12) + valueOr(awayShots, 12)) / 2, 12),
    weather: weatherSupportsGoals(enrichment.weather),
    homeXgVsAwayXg: 50,
    h2h: 50,
    form: 50,
    homeAdvantage: 50,
    injuries: 50,
    motivation: 50,
  });
  const propensity = weightedScore(factors);
  const evidence = evidenceScore([
    cornerTotal,
    shotTotal,
    enrichment.leagueAvgCorners,
    enrichment.weather?.precipitation,
  ]);
  const selection = propensity >= 55 ? 'Over 9.5 corners' : 'Under 9.5 corners';
  return {
    market: 'TOTAL_CORNERS',
    selection,
    odds: oddsOrDefault(selection.startsWith('Over') ? enrichment.odds?.totalCorners?.over : enrichment.odds?.totalCorners?.under),
    confidence: confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
