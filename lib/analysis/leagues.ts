import type { DataSource } from '@/types/analysis';

/**
 * Explicit internal-league-code → provider-identifier mappings.
 *
 * The PRD's 20 internal codes (PL, PD, BL1, …) are NOT valid identifiers for
 * either provider. This module is the single source of truth that translates
 * internal codes into what each provider actually expects, and records which
 * leagues each provider can serve on its free tier.
 *
 * Provider facts (free tiers, verified against public docs):
 *  - API-Football (v3.football.api-sports.io): fixtures require a numeric
 *    `league` id + `season` (the season is the year the season STARTS, so a
 *    2026-27 season is requested as `season=2026`). All 20 codes below resolve
 *    to a valid API-Football league id.
 *  - Football-Data.org (api.football-data.org/v4): competitions are addressed by
 *    string code (e.g. `PL`, `CL`). The free tier covers only a subset; codes
 *    not in the free tier return 404 / 403 and are treated as unsupported here.
 *    Competitions are addressed by `X-Auth-Token` header; fixtures require
 *    `dateFrom`/`dateTo` (date-only).
 */

export interface LeagueMapping {
  /** API-Football numeric league id. */
  apiFootballId: number;
  /** Football-Data.org competition code, or null if not offered (free tier). */
  footballDataCode: string | null;
}

/**
 * API-Football league ids (stable, documented by API-Sports). Used directly as
 * the `league` parameter — no runtime /leagues?code= lookup required.
 */
const API_FOOTBALL_LEAGUE_IDS: Record<string, number> = {
  PL: 39, // Premier League
  PD: 140, // La Liga
  BL1: 78, // Bundesliga
  SA: 135, // Serie A
  FL1: 61, // Ligue 1
  PPL: 94, // Primeira Liga
  ERE: 88, // Eredivisie
  CL: 2, // Champions League
  EL: 3, // Europa League
  ECL: 848, // Europa Conference League
  BL2: 79, // 2. Bundesliga
  PD2: 141, // Segunda Division
  SA2: 136, // Serie B
  FL2: 62, // Ligue 2
  ELC: 40, // Championship
  MLS: 253, // Major League Soccer
  LIB: 13, // Copa Libertadores (the authoritative "LIB" product decision)
  J1: 98, // J1 League
  ARG: 128, // Argentina Primera Division (Liga Profesional)
  BRA: 71, // Brazil Serie A
};

/**
 * Football-Data.org free-tier competition codes. Codes absent here are NOT
 * available on the free tier and must be treated as unsupported (not silently
 * skipped) so the coverage report and ingestion error log stay honest.
 */
const FOOTBALL_DATA_COMPETITION_CODES: Record<string, string | null> = {
  PL: 'PL',
  PD: 'PD',
  BL1: 'BL1',
  SA: 'SA',
  FL1: 'FL1',
  PPL: 'PPL',
  ERE: 'ERE',
  CL: 'CL',
  EL: 'EL',
  ECL: null, // Conference League not on free tier
  BL2: 'BL2',
  PD2: 'PD2',
  SA2: 'SA2',
  FL2: 'FL2',
  ELC: 'ELC',
  MLS: 'MLS',
  LIB: null, // Copa Libertadores not on free tier
  J1: null, // J1 League not on free tier
  ARG: null, // Argentina Primera not on free tier
  BRA: 'BRA', // Brazil Serie A (free tier)
};

export function apiFootballLeagueId(code: string): number | undefined {
  return API_FOOTBALL_LEAGUE_IDS[code];
}

export function footballDataCompetitionCode(code: string): string | null {
  return FOOTBALL_DATA_COMPETITION_CODES[code] ?? null;
}

/**
 * Returns the leagues (by internal code) a provider can actually serve.
 * Used for capability detection and the coverage report.
 */
export function supportedLeaguesByProvider(provider: DataSource): string[] {
  if (provider === 'api-football') {
    return Object.keys(API_FOOTBALL_LEAGUE_IDS);
  }
  return Object.entries(FOOTBALL_DATA_COMPETITION_CODES)
    .filter(([, competitionCode]) => competitionCode !== null)
    .map(([code]) => code);
}

export function isLeagueSupportedByProvider(provider: DataSource, code: string): boolean {
  return supportedLeaguesByProvider(provider).includes(code);
}

const CALENDAR_YEAR_LEAGUES = new Set(['MLS', 'LIB', 'J1', 'ARG', 'BRA']);

export function apiFootballSeasonForKickoff(kickoff: Date, leagueCode?: string): number {
  const year = kickoff.getUTCFullYear();
  if (leagueCode && CALENDAR_YEAR_LEAGUES.has(leagueCode)) return year;
  const month = kickoff.getUTCMonth();
  return month >= 6 ? year : year - 1;
}

export interface ProviderCoverageReport {
  provider: DataSource;
  totalLeagues: number;
  supportedLeagues: string[];
  unsupportedLeagues: string[];
}

export function buildProviderCoverageReport(
  allLeagueCodes: string[],
  provider: DataSource,
): ProviderCoverageReport {
  const supported = allLeagueCodes.filter((code) => isLeagueSupportedByProvider(provider, code));
  const unsupported = allLeagueCodes.filter((code) => !isLeagueSupportedByProvider(provider, code));
  return { provider, totalLeagues: allLeagueCodes.length, supportedLeagues: supported, unsupportedLeagues: unsupported };
}