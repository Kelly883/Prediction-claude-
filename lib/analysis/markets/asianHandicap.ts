import type { MarketScore } from '@/types/analysis';
import { clamp, evidenceScore, normalize } from '../utils/confidence';
import { h2hHomeScore, motivationDiffScore, scheduleScore } from '../utils/normalization';
import { buildScorelineModel, coverageSafety, fairHandicapLine, handicapCoverage } from '../utils/poisson';
import { buildFactors, injuriesImpact, oddsOrNull, valueOr } from './shared';
import type { MarketContext } from './shared';

/**
 * Asian Handicap settles the actual handicap line against the Poisson scoreline
 * distribution, including push, half-win and half-loss outcomes. The captured
 * bookmaker line (`odds.asianHandicap.line`, home perspective) is used when
 * present; otherwise the model's fair line is used and, because a fair line
 * carries no edge, the market declines to pick ("No handicap").
 */
const MIN_HANDICAP_EDGE = 0.02;

function formatLine(line: number): string {
  const rounded = Math.round(line * 4) / 4;
  if (rounded === 0) return '0';
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

export function scoreAsianHandicap(context: MarketContext): MarketScore {
  const { fixture, enrichment, weights } = context;
  const model = buildScorelineModel(enrichment);

  const capturedLine = enrichment.odds?.asianHandicap?.line;
  const hasCapturedLine = typeof capturedLine === 'number' && Number.isFinite(capturedLine);
  const homeLine = hasCapturedLine ? (capturedLine as number) : fairHandicapLine(model);
  const awayLine = -homeLine;

  const homeCoverage = handicapCoverage(model, 'home', homeLine);
  const awayCoverage = handicapCoverage(model, 'away', awayLine);

  const pickHome = homeCoverage.edge >= awayCoverage.edge;
  const chosen = pickHome ? homeCoverage : awayCoverage;
  const chosenLine = pickHome ? homeLine : awayLine;
  // Only real, captured lines are actionable — a synthesised fair line carries
  // no measurable edge, so we decline rather than fabricate a pick.
  const hasEdge = hasCapturedLine && chosen.edge > MIN_HANDICAP_EDGE;
  const selection = hasEdge
    ? `${pickHome ? fixture.homeTeam : fixture.awayTeam} ${formatLine(chosenLine)}`
    : 'No handicap';

  const factors = buildFactors(weights, {
    strengthDiff: normalize(clamp(50 + (model.expected.home - model.expected.away) * 18)),
    motivation: motivationDiffScore(enrichment.motivation?.home, enrichment.motivation?.away),
    schedule: scheduleScore(enrichment.schedule?.homeRestDays, enrichment.schedule?.awayRestDays),
    h2h: h2hHomeScore(enrichment.h2h),
    injuries: injuriesImpact(enrichment),
    referee: valueOr(enrichment.referee?.cardsPerGame, 3.5) >= 4.5 ? 58 : 50,
  });
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

  const odds = oddsOrNull(pickHome ? enrichment.odds?.asianHandicap?.home : enrichment.odds?.asianHandicap?.away);
  return {
    market: 'ASIAN_HANDICAP',
    selection,
    odds,
    oddsAvailable: odds !== null,
    confidence: hasEdge ? normalize(clamp(50 + chosen.edge * 55 * evidence, 0, 100)) : 50,
    modelProbability: hasEdge ? coverageSafety(chosen) : undefined,
    factors,
  };
}
