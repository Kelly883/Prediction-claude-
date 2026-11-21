import type { MarketScore } from '@/types/analysis';
import { confidenceFromDirection, evidenceScore, weightedScore } from '../utils/confidence';
import { motivationDiffScore, scheduleScore } from '../utils/normalization';
import { buildFactors, injuriesImpact, matchResultDirection, oddsOrDefault, scoreOf, valueOr } from './shared';
import type { MarketContext } from './shared';

export function scoreAsianHandicap(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const match = matchResultDirection(enrichment, weights);
  const factors = buildFactors(weights, {
    strengthDiff: scoreOf(match.factors, 'homeXgVsAwayXg'),
    motivation: motivationDiffScore(enrichment.motivation?.home, enrichment.motivation?.away),
    schedule: scheduleScore(enrichment.schedule?.homeRestDays, enrichment.schedule?.awayRestDays),
    h2h: scoreOf(match.factors, 'h2h'),
    injuries: injuriesImpact(enrichment),
    referee: valueOr(enrichment.referee?.cardsPerGame, 3.5) >= 4.5 ? 58 : 50,
    homeXgVsAwayXg: scoreOf(match.factors, 'homeXgVsAwayXg'),
    form: scoreOf(match.factors, 'form'),
    homeAdvantage: scoreOf(match.factors, 'homeAdvantage'),
  });
  const direction = weightedScore(factors);
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.h2h?.matches,
    enrichment.schedule?.homeRestDays,
    enrichment.schedule?.awayRestDays,
    enrichment.injuries?.home,
    enrichment.injuries?.away,
    enrichment.referee?.cardsPerGame,
  ]);
  const homeSelection = direction >= 56;
  const awaySelection = direction <= 44;
  const selection = homeSelection ? `${fixture.homeTeam} -0.5` : awaySelection ? `${fixture.awayTeam} -0.5` : 'No handicap';
  const odds = homeSelection ? enrichment.odds?.asianHandicap?.home : awaySelection ? enrichment.odds?.asianHandicap?.away : undefined;
  return {
    market: 'ASIAN_HANDICAP',
    selection,
    odds: oddsOrDefault(odds),
    confidence: selection === 'No handicap' ? 50 : confidenceFromDirection(direction, evidence),
    factors,
  };
}
