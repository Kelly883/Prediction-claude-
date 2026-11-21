import type { DataSource } from '@/types/analysis';
import mappings from './provider-mapping.json';

/**
 * Authoritative internal league -> provider identifier mapping.
 *
 * Internal league codes are the product codes locked in
 * PRD_Phase1_Foundation.md §2 ("20 standard API-Football codes"). The providers,
 * however, do NOT share identifiers or coverage:
 *
 *   - API-Football is addressed by numeric league id. The `/leagues?code=` query
 *     used previously is not a supported parameter, so ids are mapped explicitly.
 *     All 20 internal codes have a numeric API-Football id.
 *   - Football-Data.org is addressed by competition code, and the free ("Tier
 *     One") plan only exposes 12 competitions. Codes also differ from our
 *     internal codes for two leagues (ERE -> DED, BRA -> BSA). Leagues the plan
 *     does not cover carry no `footballDataCode` and must be skipped, not sent
 *     to `/competitions/{code}/` where they would 404.
 *
 * `LIB` is Liga MX per PRD assumption A2
 * (PRD_Superadmin_Daily_Match_Analysis.md, Assumption A2).
 *
 * The raw data lives in ./provider-mapping.json so build tooling (e.g. the
 * provider coverage report) can consume the same source of truth.
 */
export interface LeagueMapping {
  /** Internal product league code. */
  code: string;
  /** Canonical display name. */
  name: string;
  /** API-Football numeric league id, or undefined when not addressable. */
  apiFootballId?: number;
  /** Football-Data.org competition code, or undefined when the plan does not cover it. */
  footballDataCode?: string;
}

export const LEAGUE_MAPPINGS: readonly LeagueMapping[] = mappings as LeagueMapping[];

const BY_CODE = new Map(LEAGUE_MAPPINGS.map((mapping) => [mapping.code, mapping]));

export function leagueMapping(code: string): LeagueMapping | undefined {
  return BY_CODE.get(code.trim().toUpperCase());
}

/** API-Football numeric league id for an internal code, if mapped. */
export function apiFootballLeagueId(code: string): number | undefined {
  return leagueMapping(code)?.apiFootballId;
}

/** Football-Data.org competition code for an internal code, if covered by the plan. */
export function footballDataCompetitionCode(code: string): string | undefined {
  return leagueMapping(code)?.footballDataCode;
}

/**
 * Static capability check: does this provider have an identifier for the league
 * (i.e. is it addressable without a lookup)? This reflects plan coverage for
 * Football-Data.org and id availability for API-Football, not live entitlement.
 */
export function providerSupportsLeague(provider: DataSource, code: string): boolean {
  return provider === 'api-football'
    ? apiFootballLeagueId(code) !== undefined
    : footballDataCompetitionCode(code) !== undefined;
}

export function partitionByProviderSupport(
  provider: DataSource,
  codes: string[],
): { supported: string[]; unsupported: string[] } {
  const supported: string[] = [];
  const unsupported: string[] = [];
  for (const code of codes) {
    if (providerSupportsLeague(provider, code)) supported.push(code);
    else unsupported.push(code);
  }
  return { supported, unsupported };
}

export interface ProviderCoverage {
  provider: DataSource;
  supported: string[];
  unsupported: string[];
  supportedCount: number;
  unsupportedCount: number;
}

/** Full per-provider coverage matrix over a set of internal codes. */
export function providerCoverageMatrix(codes?: string[]): ProviderCoverage[] {
  const targets = codes ?? LEAGUE_MAPPINGS.map((mapping) => mapping.code);
  const providers: DataSource[] = ['api-football', 'football-data'];
  return providers.map((provider) => {
    const { supported, unsupported } = partitionByProviderSupport(provider, targets);
    return {
      provider,
      supported,
      unsupported,
      supportedCount: supported.length,
      unsupportedCount: unsupported.length,
    };
  });
}

/**
 * API-Football free-plan season entitlement. The free tier only serves recent
 * seasons (roughly Year-4 .. Year-2). Current-season data generally requires a
 * paid plan. Used for reporting/validation only; entitlement is enforced at
 * request time by the provider itself.
 */
export const API_FOOTBALL_FREE_TIER_SEASON_MIN_YEARS_AGO = 4;
export const API_FOOTBALL_FREE_TIER_SEASON_MAX_YEARS_AGO = 2;

export function isWithinApiFootballFreeTierSeasons(season: number, now = new Date()): boolean {
  const currentYear = now.getUTCFullYear();
  const age = currentYear - season;
  return age >= API_FOOTBALL_FREE_TIER_SEASON_MAX_YEARS_AGO && age <= API_FOOTBALL_FREE_TIER_SEASON_MIN_YEARS_AGO;
}
