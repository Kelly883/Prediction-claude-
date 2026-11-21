import type { MarketScore } from '@/types/analysis';
import { clamp, evidenceScore, normalize } from '../utils/confidence';
import { goalRateScore, h2hRateScore, weatherSupportsGoals } from '../utils/normalization';
import { buildScorelineModel, mostLikelyScoreline } from '../utils/poisson';
import { buildFactors, oddsOrDefault, valueOr } from './shared';
import type { MarketContext } from './shared';

/**
 * Correct Score uses a genuine Poisson scoreline distribution. The selected
 * scoreline is the most probable one in the (normalised) distribution, and the
 * model score reflects how concentrated that distribution is — a tighter
 * distribution (e.g. a low-scoring, predictable match) scores higher.
 *
 * Missing team stats fall back to league averages inside the Poisson model, and
 * the evidence factor keeps the model score near neutral when inputs are thin.
 */
const CORRECT_SCORE_NEUTRAL_PEAK = 0.1;

export function scoreCorrectScore(context: MarketContext): MarketScore {
  const { enrichment, weights } = context;
  const model = buildScorelineModel(enrichment);
  const mostLikely = mostLikelyScoreline(model);
  const selection = `${mostLikely.home}-${mostLikely.away}`;
  const peak = mostLikely.probability;

  const defense = goalRateScore(valueOr(enrichment.awayStats?.goalsAgainst, 1.3) + valueOr(enrichment.homeStats?.goalsAgainst, 1.3), 2.6);
  const factors = buildFactors(weights, {
    poisson: normalize(clamp(50 + (peak - CORRECT_SCORE_NEUTRAL_PEAK) * 400, 0, 100)),
    defense,
    h2hScores: h2hRateScore(enrichment.h2h?.over25Rate),
    weather: weatherSupportsGoals(enrichment.weather),
  });

  const evidence = evidenceScore([
    enrichment.homeStats?.xgFor ?? enrichment.homeStats?.goalsFor,
    enrichment.awayStats?.xgFor ?? enrichment.awayStats?.goalsFor,
    enrichment.homeStats?.goalsAgainst,
    enrichment.awayStats?.goalsAgainst,
    enrichment.h2h?.over25Rate,
    enrichment.weather?.precipitation,
  ]);
  const evidenceWeight = model.expected.source === 'league' ? Math.min(evidence, 0.25) : evidence;

  return {
    market: 'CORRECT_SCORE',
    selection,
    odds: oddsOrDefault(enrichment.odds?.correctScore?.[selection]),
    confidence: normalize(clamp(50 + (peak - CORRECT_SCORE_NEUTRAL_PEAK) * 200 * evidenceWeight, 0, 100)),
    modelProbability: peak,
    factors,
  };
}
