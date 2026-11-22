import type { MarketScore } from '@/types/analysis';
import { clamp, evidenceScore, normalize } from '../utils/confidence';
import { h2hHomeScore } from '../utils/normalization';
import { buildScorelineModel } from '../utils/poisson';
import { buildFactors, injuriesImpact, oddsOrNull } from './shared';
import type { MarketContext } from './shared';

/**
 * Double Chance is derived from the Match Result probabilities of the Poisson
 * scoreline model, so the three options are mathematically consistent
 * (Home/Draw + Away/Draw + Home/Away = 2). All three supported options are
 * considered and the highest-probability one is selected.
 */
const DOUBLE_CHANCE_NEUTRAL = 2 / 3; // the three options average 2/3
const DOUBLE_CHANCE_RANGE = 45; // maps the widest outcome (p→1) to a 95 ceiling

export function scoreDoubleChance(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const model = buildScorelineModel(enrichment);

  const options = [
    {
      selection: `${fixture.homeTeam} or Draw`,
      probability: model.homeOrDraw,
      odds: enrichment.odds?.doubleChance?.homeDraw,
    },
    {
      selection: `${fixture.awayTeam} or Draw`,
      probability: model.awayOrDraw,
      odds: enrichment.odds?.doubleChance?.drawAway,
    },
    {
      selection: `${fixture.homeTeam} or ${fixture.awayTeam}`,
      probability: model.homeOrAway,
      odds: enrichment.odds?.doubleChance?.homeAway,
    },
  ];
  const chosen = options.reduce((best, current) => (current.probability > best.probability ? current : best));

  const factors = buildFactors(weights, {
    matchResultProbability: normalize(model.homeWin * 100),
    h2h: h2hHomeScore(enrichment.h2h),
    injuries: injuriesImpact(enrichment),
  });
  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.h2h?.matches,
    enrichment.injuries?.home,
    enrichment.injuries?.away,
  ]);

  const odds = oddsOrNull(chosen.odds);
  return {
    market: 'DOUBLE_CHANCE',
    selection: chosen.selection,
    odds,
    oddsAvailable: odds !== null,
    confidence: normalize(clamp(50 + ((chosen.probability - DOUBLE_CHANCE_NEUTRAL) / (1 - DOUBLE_CHANCE_NEUTRAL)) * DOUBLE_CHANCE_RANGE * evidence, 0, 100)),
    modelProbability: chosen.probability,
    factors,
  };
}
