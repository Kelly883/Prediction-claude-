import { z } from 'zod';
import type { AnalysisOutcome, FactorScore, MarketScore, MarketType } from '@/types/analysis';

/**
 * Validation for the JSON payloads persisted on `AnalysisResult`.
 *
 * The analysis engine is the sole producer of these structures, but they are
 * serialised into `Json` columns and later consumed by the review/publish APIs.
 * Validating at the persistence boundary guarantees that a malformed score
 * object (e.g. a `NaN` confidence or an empty factor list) fails the run
 * loudly and atomically instead of being written as unusable JSON.
 */
const FactorScoreSchema = z.object({
  name: z.string().min(1),
  score: z.number().finite(),
  weight: z.number().finite(),
});

export const MarketScoreSchema = z.object({
  market: z.string().min(1),
  selection: z.string().min(1),
  odds: z.number().finite().positive(),
  confidence: z.number().finite().min(0).max(100),
  modelProbability: z.number().finite().min(0).max(1).optional(),
  factors: z.array(FactorScoreSchema).min(1),
});

const MarketScoresSchema = z.array(MarketScoreSchema).min(1);
const TopFactorsSchema = z.array(FactorScoreSchema);

export interface PersistableAnalysisResult {
  runId: string;
  fixtureId: string;
  homeTeam: string;
  awayTeam: string;
  league: string;
  kickoff: Date;
  bestMarket: MarketType;
  bestSelection: string;
  bestOdds: number;
  confidence: number;
  marketScores: MarketScore[];
  topFactors: FactorScore[];
}

/**
 * Map an engine outcome to a validated row ready for `createMany`.
 * Throws if the outcome is structurally invalid (never silently persists junk).
 */
export function toPersistableResult(runId: string, outcome: AnalysisOutcome): PersistableAnalysisResult {
  const { fixture, best, scores, topFactors } = outcome;

  if (!fixture.id || !fixture.homeTeam || !fixture.awayTeam) {
    throw new Error('Invalid fixture identity for persistence');
  }
  if (!Number.isFinite(best.odds) || best.odds <= 0) {
    throw new Error(`Invalid bestOdds for fixture ${fixture.id}: ${best.odds}`);
  }
  if (!Number.isFinite(best.confidence) || best.confidence < 0 || best.confidence > 100) {
    throw new Error(`Invalid confidence for fixture ${fixture.id}: ${best.confidence}`);
  }

  const parsedScores = MarketScoresSchema.safeParse(scores);
  if (!parsedScores.success) {
    throw new Error(
      `Invalid marketScores for fixture ${fixture.id}: ${parsedScores.error.issues
        .map((issue) => `${issue.path.join('.')} ${issue.message}`)
        .join('; ')}`,
    );
  }

  const parsedTopFactors = TopFactorsSchema.safeParse(topFactors);
  if (!parsedTopFactors.success) {
    throw new Error(`Invalid topFactors for fixture ${fixture.id}`);
  }

  return {
    runId,
    fixtureId: fixture.id,
    homeTeam: fixture.homeTeam,
    awayTeam: fixture.awayTeam,
    league: fixture.leagueCode,
    kickoff: fixture.kickoff,
    bestMarket: best.market,
    bestSelection: best.selection,
    bestOdds: best.odds,
    confidence: best.confidence,
    marketScores: parsedScores.data as MarketScore[],
    topFactors: parsedTopFactors.data as FactorScore[],
  };
}
