/**
 * Market eligibility gate.
 *
 * A market must not produce a publishable prediction merely because its scoring
 * function can return a number. Every market is evaluated against its required
 * evidence BEFORE scoring and persistence; an ineligible market is never scored
 * and can never be persisted. This is enforced in the backend — hiding a market
 * in the UI is not sufficient.
 *
 * The gate is policy-driven (`EligibilityPolicy`) so markets that are currently
 * disabled for lack of verified data can be re-enabled later once their data
 * requirements are satisfied, without deleting the market implementation.
 */
import type {
  DataSource,
  EnrichmentQuality,
  FixtureEnrichment,
  MarketEligibility,
  MarketType,
} from '@/types/analysis';

export interface EligibilityPolicy {
  /** Markets hard-disabled until their data requirements are verified. */
  disabledMarkets: MarketType[];
  /** Markets allowed only once their specific data is verified. */
  restrictedMarkets: MarketType[];
  /** Apply stricter (form-required) rules when only fallback data is available. */
  enforceStrictOnFallback: boolean;
}

/**
 * Stage 4 policy. Total Cards, First Half Result and Player Scorer are disabled
 * (the pipeline has no verified referee, first-half or player-participation
 * data). Total Corners stays restricted until corner extraction is verified —
 * `/teams/statistics` does not return corners today. Asian Handicap is
 * self-gated on a captured bookmaker line (handled per-market below).
 */
export const DEFAULT_ELIGIBILITY_POLICY: EligibilityPolicy = {
  disabledMarkets: ['TOTAL_CARDS', 'FIRST_HALF_RESULT', 'PLAYER_SCORER'],
  restrictedMarkets: ['TOTAL_CORNERS'],
  enforceStrictOnFallback: true,
};

const DEFAULT_POLICY: EligibilityPolicy = DEFAULT_ELIGIBILITY_POLICY;

function scoringFor(enrichment: FixtureEnrichment, side: 'home' | 'away'): number | undefined {
  const stats = side === 'home' ? enrichment.homeStats : enrichment.awayStats;
  return stats?.xgFor ?? stats?.goalsFor;
}

function scoringAgainst(enrichment: FixtureEnrichment, side: 'home' | 'away'): number | undefined {
  const stats = side === 'home' ? enrichment.homeStats : enrichment.awayStats;
  return stats?.xgAgainst ?? stats?.goalsAgainst;
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null;
}

interface Requirement {
  label: string;
  met: (enrichment: FixtureEnrichment) => boolean;
}

/** Required inputs for the goal-based markets. */
const GOAL_MARKETS: Partial<Record<MarketType, Requirement[]>> = {
  MATCH_RESULT: [
    { label: 'homeScoring', met: (e) => present(scoringFor(e, 'home')) },
    { label: 'awayScoring', met: (e) => present(scoringFor(e, 'away')) },
  ],
  BTTS: [
    { label: 'homeScoring', met: (e) => present(scoringFor(e, 'home')) },
    { label: 'awayScoring', met: (e) => present(scoringFor(e, 'away')) },
    { label: 'homeConceding', met: (e) => present(scoringAgainst(e, 'home')) },
    { label: 'awayConceding', met: (e) => present(scoringAgainst(e, 'away')) },
  ],
  OVER_UNDER_2_5: [
    { label: 'homeScoring', met: (e) => present(scoringFor(e, 'home')) },
    { label: 'awayScoring', met: (e) => present(scoringFor(e, 'away')) },
  ],
  DOUBLE_CHANCE: [
    { label: 'homeScoring', met: (e) => present(scoringFor(e, 'home')) },
    { label: 'awayScoring', met: (e) => present(scoringFor(e, 'away')) },
  ],
  CORRECT_SCORE: [
    { label: 'homeScoring', met: (e) => present(scoringFor(e, 'home')) },
    { label: 'awayScoring', met: (e) => present(scoringFor(e, 'away')) },
  ],
};

const FALLBACK_EXTRA: Requirement[] = [
  { label: 'homeForm', met: (e) => present(e.homeStats?.form) },
  { label: 'awayForm', met: (e) => present(e.awayStats?.form) },
];

const CORNERS_REQUIREMENTS: Requirement[] = [
  { label: 'homeCorners', met: (e) => present(e.homeStats?.cornersFor) },
  { label: 'awayCorners', met: (e) => present(e.awayStats?.cornersFor) },
];

function missingFieldsFor(requirements: Requirement[], enrichment: FixtureEnrichment): string[] {
  return requirements.filter((requirement) => !requirement.met(enrichment)).map((requirement) => requirement.label);
}

function oddsAvailableFor(market: MarketType, enrichment: FixtureEnrichment): boolean {
  const odds = enrichment.odds;
  switch (market) {
    case 'MATCH_RESULT':
      return present(odds?.matchResult?.home) || present(odds?.matchResult?.draw) || present(odds?.matchResult?.away);
    case 'BTTS':
      return present(odds?.btts?.yes) || present(odds?.btts?.no);
    case 'OVER_UNDER_2_5':
      return present(odds?.overUnder25?.over) || present(odds?.overUnder25?.under);
    case 'ASIAN_HANDICAP':
      return present(odds?.asianHandicap?.line);
    case 'DOUBLE_CHANCE':
      return present(odds?.doubleChance?.homeDraw) || present(odds?.doubleChance?.drawAway) || present(odds?.doubleChance?.homeAway);
    case 'CORRECT_SCORE':
      return present(odds?.correctScore) && Object.keys(odds?.correctScore ?? {}).length > 0;
    case 'TOTAL_CORNERS':
      return present(odds?.totalCorners?.over) || present(odds?.totalCorners?.under);
    default:
      return false;
  }
}

/** Markets that require a real captured bookmaker price to be actionable. */
const ODDS_REQUIRED: ReadonlySet<MarketType> = new Set<MarketType>(['ASIAN_HANDICAP']);

/** True when the market can only be published with a real captured bookmaker price. */
export function marketRequiresOdds(market: MarketType): boolean {
  return ODDS_REQUIRED.has(market);
}

/**
 * Decide whether a market may proceed to scoring and persistence, and record
 * why. Never throws; always returns a structured decision.
 */
export function evaluateMarketEligibility(
  market: MarketType,
  enrichment: FixtureEnrichment,
  policy: EligibilityPolicy = DEFAULT_POLICY,
): MarketEligibility {
  const dataQuality: EnrichmentQuality = enrichment.quality ?? 'INSUFFICIENT_DATA';
  const dataSources: DataSource[] = enrichment.dataSource ? [enrichment.dataSource] : [];
  const oddsAvailable = oddsAvailableFor(market, enrichment);

  const base = { market, dataSources, dataQuality, oddsAvailable };

  if (policy.disabledMarkets.includes(market)) {
    return {
      ...base,
      eligible: false,
      allowedToProceed: false,
      reason: 'Market disabled by policy: required data source is not yet verified',
      missingFields: ['policy:disabled'],
    };
  }

  if (policy.restrictedMarkets.includes(market)) {
    const missing = missingFieldsFor(CORNERS_REQUIREMENTS, enrichment);
    const eligible = missing.length === 0;
    return {
      ...base,
      eligible,
      allowedToProceed: eligible,
      reason: eligible
        ? 'Corner data verified for both teams'
        : 'Total Corners restricted: verified corner data is unavailable',
      missingFields: missing,
    };
  }

  // Asian Handicap self-gates on a captured bookmaker line.
  if (market === 'ASIAN_HANDICAP') {
    const eligible = present(enrichment.odds?.asianHandicap?.line);
    return {
      ...base,
      eligible,
      allowedToProceed: eligible,
      reason: eligible
        ? 'Captured Asian handicap line available'
        : 'Asian Handicap requires a captured bookmaker handicap line',
      missingFields: eligible ? [] : ['odds.asianHandicap.line'],
    };
  }

  const requirements = GOAL_MARKETS[market];
  if (!requirements) {
    return {
      ...base,
      eligible: false,
      allowedToProceed: false,
      reason: 'No eligibility policy defined for this market',
      missingFields: ['policy:undefined'],
    };
  }

  const effective = dataQuality === 'FALLBACK_PARTIAL' && policy.enforceStrictOnFallback
    ? [...requirements, ...FALLBACK_EXTRA]
    : requirements;
  let missing = missingFieldsFor(effective, enrichment);

  if (ODDS_REQUIRED.has(market) && !oddsAvailable) {
    missing = [...missing, 'odds'];
  }

  const eligible = missing.length === 0;
  return {
    ...base,
    eligible,
    allowedToProceed: eligible,
    reason: eligible
      ? `Required inputs present (${dataQuality})`
      : `Missing required inputs: ${missing.join(', ')}`,
    missingFields: missing,
  };
}

/** Evaluate every market in a fixed order. */
export function evaluateAllEligibility(
  markets: MarketType[],
  enrichment: FixtureEnrichment,
  policy: EligibilityPolicy = DEFAULT_POLICY,
): MarketEligibility[] {
  return markets.map((market) => evaluateMarketEligibility(market, enrichment, policy));
}
