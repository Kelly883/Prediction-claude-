import type { MarketScore } from '@/types/analysis';
import { confidenceFromDirection, evidenceScore, strengthDiffScore, weightedScore } from '../utils/confidence';
import { formScore, h2hHomeScore, motivationDiffScore } from '../utils/normalization';
import { buildFactors, matchResultDirection, oddsOrDefault, scoreOf } from './shared';
import type { MarketContext } from './shared';

export function scoreFirstHalfResult(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const match = matchResultDirection(enrichment, weights);
  const homeFirstHalf = enrichment.homeStats?.firstHalfGoalsFor ?? (enrichment.homeStats?.xgFor ? enrichment.homeStats.xgFor * 0.45 : undefined);
  const awayFirstHalf = enrichment.awayStats?.firstHalfGoalsFor ?? (enrichment.awayStats?.xgFor ? enrichment.awayStats.xgFor * 0.45 : undefined);
  const h2hFirstHalf = enrichment.h2h?.firstHalfHomeWins !== undefined && enrichment.h2h?.matches
    ? (enrichment.h2h.firstHalfHomeWins + (enrichment.h2h.firstHalfDraws ?? 0) * 0.5) / enrichment.h2h.matches * 100
    : undefined;
  const factors = buildFactors(weights, {
    earlyPatterns: (formScore(enrichment.homeStats?.form) + (100 - formScore(enrichment.awayStats?.form))) / 2,
    firstHalfXg: homeFirstHalf !== undefined && awayFirstHalf !== undefined ? strengthDiffScore(homeFirstHalf, awayFirstHalf) : scoreOf(match.factors, 'homeXgVsAwayXg'),
    h2hFirstHalf: h2hFirstHalf ?? h2hHomeScore(enrichment.h2h),
    motivation: motivationDiffScore(enrichment.motivation?.home, enrichment.motivation?.away),
    homeXgVsAwayXg: scoreOf(match.factors, 'homeXgVsAwayXg'),
    h2h: h2hHomeScore(enrichment.h2h),
    form: scoreOf(match.factors, 'form'),
    homeAdvantage: scoreOf(match.factors, 'homeAdvantage'),
    injuries: scoreOf(match.factors, 'injuries'),
  });
  const direction = weightedScore(factors);
  const evidence = evidenceScore([
    homeFirstHalf,
    awayFirstHalf,
    enrichment.h2h?.firstHalfHomeWins,
    enrichment.homeStats?.form?.length,
    enrichment.awayStats?.form?.length,
    enrichment.motivation?.home,
    enrichment.motivation?.away,
  ]);
  const selection = direction >= 56 ? fixture.homeTeam : direction <= 44 ? fixture.awayTeam : 'Draw';
  const odds = selection === fixture.homeTeam
    ? enrichment.odds?.firstHalfResult?.home
    : selection === fixture.awayTeam
      ? enrichment.odds?.firstHalfResult?.away
      : enrichment.odds?.firstHalfResult?.draw;
  return {
    market: 'FIRST_HALF_RESULT',
    selection,
    odds: oddsOrDefault(odds),
    confidence: selection === 'Draw' ? Math.min(70, confidenceFromDirection(direction, evidence)) : confidenceFromDirection(direction, evidence),
    factors,
  };
}
