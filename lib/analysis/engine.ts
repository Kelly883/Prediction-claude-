import { DEFAULT_ANALYSIS_SETTINGS, MARKET_ORDER } from './config';
import { scoreAsianHandicap } from './markets/asianHandicap';
import { scoreBtts } from './markets/btts';
import { scoreCorrectScore } from './markets/correctScore';
import { scoreDoubleChance } from './markets/doubleChance';
import { DEFAULT_ELIGIBILITY_POLICY, evaluateAllEligibility, type EligibilityPolicy } from './markets/eligibility';
import { scoreFirstHalfResult } from './markets/firstHalfResult';
import { scoreMatchResult } from './markets/matchResult';
import { scoreOverUnder } from './markets/overUnder';
import { scorePlayerScorer } from './markets/playerScorer';
import { scoreTotalCards } from './markets/totalCards';
import { scoreTotalCorners } from './markets/totalCorners';
import type { MarketContext } from './markets/shared';
import { topFactors } from './utils/confidence';
import type { AnalysisOutcome, AnalysisSettings, Fixture, FixtureEnrichment, MarketScore, MarketType } from '@/types/analysis';

/**
 * Score a fixture.
 *
 * The market eligibility gate runs FIRST: a market whose required evidence is
 * unavailable is not scored at all and can never be ranked, selected or
 * persisted. `outcome.eligibility` records the decision for every market
 * (eligible or not) so administrators can see exactly why a market was skipped.
 */
export function scoreFixture(
  fixture: Fixture,
  enrichment: FixtureEnrichment,
  settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS,
  policy: EligibilityPolicy = DEFAULT_ELIGIBILITY_POLICY,
): AnalysisOutcome {
  const eligibility = evaluateAllEligibility(MARKET_ORDER, enrichment, policy);
  const allowed = new Set(eligibility.filter((decision) => decision.allowedToProceed).map((decision) => decision.market));

  const scores: MarketScore[] = [];
  const add = (market: MarketType, score: (context: MarketContext) => MarketScore) => {
    if (!allowed.has(market)) return;
    const weights = settings.marketWeights[market] ?? DEFAULT_ANALYSIS_SETTINGS.marketWeights[market] ?? {};
    scores.push(score({ fixture, enrichment, weights }));
  };

  add('MATCH_RESULT', scoreMatchResult);
  add('BTTS', scoreBtts);
  add('OVER_UNDER_2_5', scoreOverUnder);
  add('ASIAN_HANDICAP', scoreAsianHandicap);
  add('DOUBLE_CHANCE', scoreDoubleChance);
  add('CORRECT_SCORE', scoreCorrectScore);
  add('FIRST_HALF_RESULT', scoreFirstHalfResult);
  add('TOTAL_CORNERS', scoreTotalCorners);
  add('TOTAL_CARDS', scoreTotalCards);
  add('PLAYER_SCORER', scorePlayerScorer);

  const ranked = [...scores].sort((left, right) => {
    if (right.confidence !== left.confidence) return right.confidence - left.confidence;
    return MARKET_ORDER.indexOf(left.market) - MARKET_ORDER.indexOf(right.market);
  });
  const best = ranked[0];
  return {
    fixture,
    scores,
    best,
    topFactors: best ? topFactors(best.factors, 3) : [],
    eligibility,
  };
}

/**
 * Keep only outcomes whose best (eligible) market meets the threshold. Outcomes
 * with no eligible market are always dropped, regardless of threshold.
 */
export function filterPicks(outcomes: AnalysisOutcome[], threshold: number = DEFAULT_ANALYSIS_SETTINGS.threshold): AnalysisOutcome[] {
  return outcomes.filter((outcome) => outcome.best !== undefined && outcome.best.confidence >= threshold);
}

export function bestMarketOf(outcomes: AnalysisOutcome[]): MarketType | undefined {
  return outcomes.find((outcome) => outcome.best !== undefined)?.best?.market;
}
