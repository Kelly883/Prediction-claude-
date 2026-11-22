import type { MarketType } from '@prisma/client';

export type { MarketType };

export type DataSource = 'api-football' | 'football-data';

/**
 * Normalised fixture status. Provider status codes are mapped onto this small
 * internal vocabulary so ingestion can decide, once, which fixtures are
 * predictable. Only `scheduled` fixtures are eligible for prediction.
 */
export type FixtureStatus =
  | 'scheduled'
  | 'in_play'
  | 'finished'
  | 'postponed'
  | 'cancelled'
  | 'suspended'
  | 'abandoned'
  | 'awarded'
  | 'unknown';

/**
 * Enrichment data-quality classification. `PRIMARY_*` means the primary
 * provider (API-Football) supplied the data; `FALLBACK_PARTIAL` means only the
 * secondary provider (Football-Data.org) was available, which does NOT supply
 * the full set of markets' inputs. `INSUFFICIENT_DATA` means neither provider
 * produced usable enrichment.
 */
export type EnrichmentQuality =
  | 'PRIMARY_COMPLETE'
  | 'PRIMARY_PARTIAL'
  | 'FALLBACK_PARTIAL'
  | 'INSUFFICIENT_DATA';

export interface LeagueConfigRecord {
  id?: string;
  leagueName: string;
  leagueCode: string;
  isEnabled: boolean;
  priority: number;
}

export interface Fixture {
  id: string;
  leagueCode: string;
  leagueName: string;
  kickoff: Date;
  homeTeam: string;
  awayTeam: string;
  homeTeamId?: string;
  awayTeamId?: string;
  venueLatitude?: number;
  venueLongitude?: number;
  /** Normalised provider status. Missing values are treated as `unknown`. */
  status?: FixtureStatus;
  /** Raw provider status label (short code or description), for diagnostics. */
  statusLabel?: string;
  /** Provider season identifier used for enrichment requests (e.g. "2026"). */
  seasonId?: string;
  source: DataSource;
}

export interface TeamStats {
  xgFor?: number;
  xgAgainst?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  form?: string[];
  cornersFor?: number;
  cornersAgainst?: number;
  cardsFor?: number;
  cardsAgainst?: number;
  firstHalfGoalsFor?: number;
  firstHalfGoalsAgainst?: number;
  shotsFor?: number;
  shotsAgainst?: number;
}

export interface H2HRecord {
  matches?: number;
  homeWins?: number;
  draws?: number;
  awayWins?: number;
  bttsRate?: number;
  over25Rate?: number;
  avgGoals?: number;
  firstHalfHomeWins?: number;
  firstHalfDraws?: number;
  firstHalfAwayWins?: number;
}

export interface InjuryRecord {
  home?: number;
  away?: number;
  keyHome?: number;
  keyAway?: number;
}

export interface OddsRecord {
  /** Provider that supplied these odds. */
  provider?: DataSource;
  /** Bookmaker name the prices were captured from. */
  bookmaker?: string;
  /** Provider-reported capture timestamp (ISO string), when available. */
  capturedAt?: string;
  matchResult?: { home?: number; draw?: number; away?: number };
  btts?: { yes?: number; no?: number };
  overUnder25?: { over?: number; under?: number };
  asianHandicap?: { home?: number; away?: number; line?: number };
  doubleChance?: { homeDraw?: number; homeAway?: number; drawAway?: number };
  correctScore?: Record<string, number>;
  firstHalfResult?: { home?: number; draw?: number; away?: number };
  totalCorners?: { over?: number; under?: number; line?: number };
  totalCards?: { over?: number; under?: number; line?: number };
  playerScorer?: Record<string, number>;
}

export interface WeatherRecord {
  precipitation?: number;
  windSpeed?: number;
  temperature?: number;
  condition?: string;
}

export interface PlayerRecord {
  name: string;
  goals?: number;
  minutes?: number;
  penalties?: number;
  position?: string;
  shots?: number;
}

export interface FixtureEnrichment {
  homeStats?: TeamStats;
  awayStats?: TeamStats;
  h2h?: H2HRecord;
  injuries?: InjuryRecord;
  odds?: OddsRecord;
  weather?: WeatherRecord;
  leagueAvgGoals?: number;
  leagueAvgCorners?: number;
  leagueAvgCards?: number;
  pace?: number;
  motivation?: { home?: number; away?: number };
  schedule?: { homeRestDays?: number; awayRestDays?: number };
  referee?: { cardsPerGame?: number };
  players?: PlayerRecord[];
  /** Provider that actually supplied the enrichment (not merely the preferred one). */
  dataSource?: DataSource;
  /** Data-quality classification derived from which provider/fields were available. */
  quality?: EnrichmentQuality;
  /** Named inputs that were required but unavailable, for admin transparency. */
  missingFields?: string[];
  errors?: string[];
}

export interface FactorScore {
  name: string;
  score: number;
  weight: number;
}

export interface MarketScore {
  market: MarketType;
  selection: string;
  /**
   * Real bookmaker decimal price from a provider response, or `null` when no
   * valid price was captured. A fabricated fallback price is never stored here.
   */
  odds: number | null;
  /** True only when `odds` came from a valid provider response. */
  oddsAvailable: boolean;
  /**
   * Heuristic model score (0–100). This is NOT a calibrated win probability —
   * it combines weighted factor direction with data availability. The field
   * name is preserved for database/API compatibility; user-facing surfaces
   * label it "Model score". See docs/PHASE_1_PRODUCTION_READINESS_AUDIT.md §E.
   */
  confidence: number;
  /**
   * Model-derived probability (0–1) for the selected outcome, where the market
   * has a genuine probabilistic model (Match Result, Double Chance, Correct
   * Score, Asian Handicap). Still a MODEL estimate, not a calibrated figure.
   */
  modelProbability?: number;
  factors: FactorScore[];
}

/**
 * Structured result of the market eligibility gate. Every market is evaluated
 * before scoring; ineligible markets are not scored and can never be persisted.
 */
export interface MarketEligibility {
  market: MarketType;
  eligible: boolean;
  reason: string;
  missingFields: string[];
  dataSources: DataSource[];
  dataQuality: EnrichmentQuality;
  oddsAvailable: boolean;
  /** True only when the market should proceed to scoring and persistence. */
  allowedToProceed: boolean;
}

export interface AnalysisOutcome {
  fixture: Fixture;
  /** Scores for ELIGIBLE markets only. Ineligible markets are never scored. */
  scores: MarketScore[];
  /**
   * Highest-ranked eligible market, or `undefined` when no market passed the
   * eligibility gate. An outcome with no `best` must never be persisted.
   */
  best?: MarketScore;
  topFactors: FactorScore[];
  /** Eligibility decision for every market, including ineligible ones. */
  eligibility: MarketEligibility[];
  /** Enrichment data-quality classification carried through to persistence. */
  enrichmentQuality?: EnrichmentQuality;
  /** Provider that actually supplied the enrichment. */
  providerSource?: DataSource;
  /** Required inputs that were unavailable, carried through to persistence. */
  missingFields?: string[];
  /** `${provider}:${bookmaker}` provenance for the selected odds, when present. */
  oddsSource?: string;
  /** Timestamp the odds were captured from the provider, when present. */
  oddsCapturedAt?: Date;
}

export type MarketWeights = Record<MarketType, Record<string, number>>;

export interface AnalysisSettings {
  threshold: number;
  marketWeights: MarketWeights;
  dataSourcePriorities: DataSource[];
}

export interface StoredAnalysisConfig {
  key: string;
  value: unknown;
}
