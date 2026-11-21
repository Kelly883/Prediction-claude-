import type { MarketScore } from '@/types/analysis';
import { clamp, evidenceScore, normalize, weightedScore } from '../utils/confidence';
import { h2hHomeScore } from '../utils/normalization';
import { buildFactors, injuriesImpact, matchResultDirection, oddsOrDefault, scoreOf } from './shared';
import type { MarketContext } from './shared';

export function scoreDoubleChance(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const match = matchResultDirection(enrichment, weights);
  const direction = scoreOf(match.factors, 'homeXgVsAwayXg') !== 50
    ? weightedScore(match.factors)
    : scoreOf(match.factors, 'h2h');
  const factors = buildFactors(weights, {
    matchResultProbability: direction,
    h2h: h2hHomeScore(enrichment.h2h),
    injuries: injuriesImpact(enrichment),
    homeXgVsAwayXg: scoreOf(match.factors, 'homeXgVsAwayXg'),
    form: scoreOf(match.factors, 'form'),
    homeAdvantage: scoreOf(match.factors, 'homeAdvantage'),
  });
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.h2h?.matches,
    enrichment.injuries?.home,
    enrichment.injuries?.away,
  ]);
  const homeSide = direction >= 50;
  const selection = homeSide ? `${fixture.homeTeam} or Draw` : `${fixture.awayTeam} or Draw`;
  const confidence = normalize(clamp(58 + Math.abs(direction - 50) * 1.4 * evidence, 0, 95));
  const odds = homeSide ? enrichment.odds?.doubleChance?.homeDraw : enrichment.odds?.doubleChance?.drawAway;
  return {
    market: 'DOUBLE_CHANCE',
    selection,
    odds: oddsOrDefault(odds),
    confidence,
    factors,
  };
}
