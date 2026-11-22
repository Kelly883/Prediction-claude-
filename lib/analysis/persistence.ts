import { z } from 'zod';
import type { AnalysisOutcome, FactorScore, MarketEligibility, MarketScore, MarketType } from '@/types/analysis';

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
  // Odds are a REAL provider price or `null`. A fabricated default must never
  // be persisted (Stage 3). `oddsAvailable` records whether a real price exists.
  odds: z.number().finite().positive().nullable(),
  oddsAvailable: z.boolean(),
  confidence: z.number().finite().min(0).max(100),
  modelProbability: z.number().finite().min(0).max(1).optional(),
  factors: z.array(FactorScoreSchema).min(1),
});

export const MarketEligibilitySchema = z.object({
  market: z.string().min(1),
  eligible: z.boolean(),
  reason: z.string(),
  missingFields: z.array(z.string()),
  dataSources: z.array(z.string()),
  dataQuality: z.string(),
  oddsAvailable: z.boolean(),
  allowedToProceed: z.boolean(),
});

const MarketScoresSchema = z.array(MarketScoreSchema).min(1);
const MarketEligibilityArraySchema = z.array(MarketEligibilitySchema);
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
  /** Real provider odds, or `null` when no captured best price exists. */
  bestOdds: number | null;
  confidence: number;
  marketScores: MarketScore[];
  topFactors: FactorScore[];
  // --- Stage 6/8 data-quality + provenance fields (all nullable) ---
  enrichmentQuality: string | null;
  providerSource: string | null;
  missingDataFields: string[];
  marketEligibility: MarketEligibility[];
  /** Reason the best market's competitors were excluded / market gating summary. */
  marketExclusionReason: string | null;
  fixtureStatus: string | null;
  seasonId: string | null;
  oddsSource: string | null;
  oddsCapturedAt: Date | null;
}

/** Summary of why markets were excluded, for admin review. */
function exclusionSummary(eligibility: MarketEligibility[]): string | null {
  const excluded = eligibility.filter((decision) => !decision.allowedToProceed);
  if (excluded.length === 0) return null;
  return excluded.map((decision) => `${decision.market}: ${decision.reason}`).join(' | ');
}

/**
 * Map an engine outcome to a validated row ready for `createMany`.
 * Throws if the outcome is structurally invalid (never silently persists junk),
 * and refuses to persist an outcome with no eligible market or a fabricated
 * (non-provider) odds value.
 */
export function toPersistableResult(runId: string, outcome: AnalysisOutcome): PersistableAnalysisResult {
  const { fixture, best, scores, topFactors, eligibility } = outcome;

  if (!fixture.id || !fixture.homeTeam || !fixture.awayTeam) {
    throw new Error('Invalid fixture identity for persistence');
  }
  if (!best) {
    throw new Error(`No eligible market for fixture ${fixture.id}; refusing to persist`);
  }
  // Odds are either a real finite price > 1, or null. Never fabricated.
  if (best.odds !== null && (!Number.isFinite(best.odds) || best.odds <= 1)) {
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

  const parsedEligibility = MarketEligibilityArraySchema.safeParse(eligibility ?? []);
  const marketEligibility = parsedEligibility.success ? (parsedEligibility.data as MarketEligibility[]) : [];

  const oddsSource = best.odds !== null && outcome.oddsSource ? outcome.oddsSource : null;

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
    enrichmentQuality: outcome.enrichmentQuality ?? null,
    providerSource: outcome.providerSource ?? null,
    missingDataFields: outcome.missingFields ?? [],
    marketEligibility,
    marketExclusionReason: exclusionSummary(marketEligibility),
    fixtureStatus: fixture.status ?? null,
    seasonId: fixture.seasonId ?? null,
    oddsSource,
    oddsCapturedAt: outcome.oddsCapturedAt ?? null,
  };
}
