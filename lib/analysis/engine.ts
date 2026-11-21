import { DEFAULT_ANALYSIS_SETTINGS, MARKET_ORDER } from './config';
import { scoreAsianHandicap } from './markets/asianHandicap';
import { scoreBtts } from './markets/btts';
import { scoreCorrectScore } from './markets/correctScore';
import { scoreDoubleChance } from './markets/doubleChance';
import { scoreFirstHalfResult } from './markets/firstHalfResult';
import { scoreMatchResult } from './markets/matchResult';
import { scoreOverUnder } from './markets/overUnder';
import { scorePlayerScorer } from './markets/playerScorer';
import { scoreTotalCards } from './markets/totalCards';
import { scoreTotalCorners } from './markets/totalCorners';
import type { MarketContext } from './markets/shared';
import { topFactors } from './utils/confidence';
import type { AnalysisOutcome, AnalysisSettings, Fixture, FixtureEnrichment, MarketScore, MarketType } from '@/types/analysis';

export function scoreFixture(
  fixture: Fixture,
  enrichment: FixtureEnrichment,
  settings: AnalysisSettings = DEFAULT_ANALYSIS_SETTINGS,
): AnalysisOutcome {
  const scores: MarketScore[] = [];
  const add = (market: MarketType, score: (context: MarketContext) => MarketScore) => {
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
    topFactors: topFactors(best.factors, 3),
  };
}

export function filterPicks(outcomes: AnalysisOutcome[], threshold: number = DEFAULT_ANALYSIS_SETTINGS.threshold): AnalysisOutcome[] {
  return outcomes.filter((outcome) => outcome.best.confidence >= threshold);
}

export function bestMarketOf(outcomes: AnalysisOutcome[]): MarketType | undefined {
  return outcomes[0]?.best.market;
}
