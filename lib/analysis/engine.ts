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
import type { AnalysisOutcome, AnalysisSettings, DataQuality, EvidenceLabel, Fixture, FixtureEnrichment, MarketScore, MarketType } from '@/types/analysis';

/**
 * Score a fixture.
 *
 * The market eligibility gate runs FIRST: a market whose required evidence is
 * unavailable is not scored at all and can never be ranked, selected or
 * persisted. `outcome.eligibility` records the decision for every market
 * (eligible or not) so administrators can see exactly why a market was skipped.
 */

function evidenceLabelForQuality(quality: DataQuality): EvidenceLabel {
  switch (quality) {
    case 'PRIMARY_COMPLETE':
    case 'PRIMARY_PARTIAL':
      return 'VERIFIED';
    case 'FALLBACK_PARTIAL':
      return 'ESTIMATED';
    default:
      return 'NOT VERIFIED';
  }
}

function confidenceLabelForQuality(quality: DataQuality): string {
  switch (quality) {
    case 'PRIMARY_COMPLETE':
    case 'PRIMARY_PARTIAL':
      return 'CALIBRATED_MODEL_SCORE';
    case 'FALLBACK_PARTIAL':
      return 'HEURISTIC_MODEL_SCORE';
    default:
      return 'HEURISTIC_MODEL_SCORE';
  }
}

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
    const marketScore = score({ fixture, enrichment, weights });
    // Attach evidence label and confidence label based on data quality.
    const evidenceLabel = evidenceLabelForQuality(enrichment.dataQuality ?? 'INSUFFICIENT_DATA');
    marketScore.confidenceLabel = confidenceLabelForQuality(enrichment.dataQuality ?? 'INSUFFICIENT_DATA');
    marketScore.evidence = {
      label: evidenceLabel,
      dataQuality: enrichment.dataQuality ?? 'INSUFFICIENT_DATA',
      oddsAvailability: enrichment.odds ? 'AVAILABLE' : 'MISSING',
      strength: enrichment.dataQuality === 'PRIMARY_COMPLETE' ? 1 : enrichment.dataQuality === 'PRIMARY_PARTIAL' ? 0.7 : 0.4,
      sources: enrichment.sources?.map((s) => s.provider) ?? [],
    };
    scores.push(marketScore);
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

  const evidenceLabel = evidenceLabelForQuality(enrichment.dataQuality ?? 'INSUFFICIENT_DATA');
  return {
    fixture,
    scores,
    best: scores[0],
    topFactors: scores[0] ? topFactors(scores[0].factors, 3) : [],
    eligibility,
    evidenceLabel,
    dataQuality: enrichment.dataQuality,
    enrichmentQuality: enrichment.quality,
    providerSource: enrichment.dataSource,
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
