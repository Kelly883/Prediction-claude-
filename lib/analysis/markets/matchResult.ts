import type { MarketScore } from '@/types/analysis';
import { confidenceFromDirection, confidenceFromPropensity, evidenceScore } from '../utils/confidence';
import { h2hDrawScore } from '../utils/normalization';
import { injuriesImpact, matchResultDirection, oddsOrDefault, threeWaySelection, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreMatchResult(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const { direction, factors } = matchResultDirection(enrichment, weights);
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.h2h?.matches,
    enrichment.homeStats?.form?.length,
    enrichment.awayStats?.form?.length,
    enrichment.injuries?.home,
    enrichment.injuries?.away,
    enrichment.motivation?.home,
    enrichment.motivation?.away,
  ]);
  const selection = threeWaySelection(direction, fixture.homeTeam, fixture.awayTeam);
  const drawConfidence = Math.min(70, confidenceFromPropensity(h2hDrawScore(enrichment.h2h), evidence));
  const confidence = selection === 'Draw' ? drawConfidence : confidenceFromDirection(direction, evidence);
  const odds = selection === fixture.homeTeam
    ? enrichment.odds?.matchResult?.home
    : selection === fixture.awayTeam
      ? enrichment.odds?.matchResult?.away
      : enrichment.odds?.matchResult?.draw;

  return {
    market: 'MATCH_RESULT',
    selection,
    odds: oddsOrDefault(odds),
    confidence,
    factors,
  };
}

export function matchResultEvidenceScore(context: MarketContext): number {
  const { enrichment } = context;
  return evidenceScore([
    enrichment.homeStats?.xgFor,
    enrichment.awayStats?.xgFor,
    enrichment.h2h?.matches,
    enrichment.homeStats?.form?.length,
    enrichment.awayStats?.form?.length,
    enrichment.injuries?.home,
    enrichment.injuries?.away,
    injuriesImpact(enrichment) === 50 ? undefined : valueOr(enrichment.injuries?.home, 0),
  ]);
}
