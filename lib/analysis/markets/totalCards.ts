import type { MarketScore } from '@/types/analysis';
import { confidenceFromPropensity, evidenceScore, weightedScore } from '../utils/confidence';
import { goalRateScore } from '../utils/normalization';
import { buildFactors, oddsOrNull } from './shared';
import type { MarketContext } from './shared';

export function scoreTotalCards(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const homeCards = enrichment.homeStats?.cardsFor;
  const awayCards = enrichment.awayStats?.cardsFor;
  const cardTotal = homeCards !== undefined && awayCards !== undefined ? homeCards + awayCards : undefined;
  const stakes = enrichment.motivation?.home !== undefined && enrichment.motivation?.away !== undefined
    ? (enrichment.motivation.home + enrichment.motivation.away) / 2
    : undefined;
  const factors = buildFactors(weights, {
    referee: goalRateScore(enrichment.referee?.cardsPerGame, 4),
    rivalry: enrichment.h2h?.matches && enrichment.h2h.matches >= 4 ? 65 : 50,
    discipline: goalRateScore(cardTotal, 4.5),
    leagueAvg: goalRateScore(enrichment.leagueAvgCards, 4.5),
    stakes: stakes ?? 50,
    homeXgVsAwayXg: 50,
    h2h: cardTotal !== undefined ? goalRateScore(cardTotal, 4.5) : 50,
    form: 50,
    homeAdvantage: 50,
    injuries: 50,
    motivation: stakes ?? 50,
  });
  const propensity = weightedScore(factors);
  const evidence = evidenceScore([
    enrichment.referee?.cardsPerGame,
    enrichment.h2h?.matches,
    cardTotal,
    enrichment.leagueAvgCards,
    stakes,
  ]);
  const selection = propensity >= 55 ? 'Over 4.5 cards' : 'Under 4.5 cards';
  const odds = oddsOrNull(selection.startsWith('Over') ? enrichment.odds?.totalCards?.over : enrichment.odds?.totalCards?.under);
  return {
    market: 'TOTAL_CARDS',
    selection,
    odds,
    oddsAvailable: odds !== null,
    confidence: confidenceFromPropensity(propensity, evidence),
    factors,
  };
}
