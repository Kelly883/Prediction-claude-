/**
 * League readiness / entitlement assessment (Stage 2).
 *
 * A league is only eligible for automated prediction generation when its
 * competition id is valid, its current season is correctly derived, the
 * provider addresses that season, and (at runtime) fixtures and the required
 * enrichment can actually be fetched.
 *
 * This module performs the *static* portion of that assessment — id mapping and
 * competition-aware season derivation — and explicitly labels live provider
 * entitlement. It deliberately does NOT fabricate an entitlement result: with no
 * authorized live probe, entitlement stays `NOT_VERIFIED`, which is surfaced to
 * administrators rather than silently assumed.
 *
 * A single league failing readiness never disables the others: each league is
 * assessed independently and reports its own reason.
 */
import { apiFootballLeagueId, footballDataCompetitionCode, isWithinApiFootballFreeTierSeasons } from '@/lib/api/provider-mapping';
import { deriveSeason, deriveSeasonId, seasonStrategy, type SeasonStrategy } from '@/lib/api/season';
import type { DataSource } from '@/types/analysis';

/** Entitlement is only VERIFIED when demonstrated by a live provider response. */
export type EntitlementStatus = 'VERIFIED' | 'NOT_VERIFIED';

export interface LeagueInput {
  leagueCode: string;
  leagueName?: string;
}

export interface LeagueReadiness {
  leagueCode: string;
  leagueName: string;
  /** Static data-source identifiers available for this league. */
  apiFootballId?: number;
  footballDataCode?: string;
  /** Competition-aware season derived from the assessment date. */
  season: number;
  seasonId: string;
  seasonStrategy: SeasonStrategy;
  /** Provider has an addressable identifier for this competition. */
  addressable: boolean;
  /** Assumed primary data source for this league. */
  primarySource: DataSource;
  /** Live entitlement probe status. */
  entitlement: EntitlementStatus;
  /**
   * Best-effort signal: is the derived season inside the documented API-Football
   * free-tier window? A `false` value means the free plan cannot serve it; a paid
   * plan still must be confirmed live (entitlement stays NOT_VERIFIED).
   */
  withinFreeTierSeason: boolean;
  /** True only when the league can be attempted for automated prediction. */
  eligible: boolean;
  /** Human-readable reason, surfaced to administrators. */
  reason: string;
}

/**
 * Assess a single league. Pure and side-effect free — no network access.
 */
export function assessLeagueReadiness(league: LeagueInput, now: Date = new Date()): LeagueReadiness {
  const leagueCode = league.leagueCode;
  const apiFootballId = apiFootballLeagueId(leagueCode);
  const footballDataCode = footballDataCompetitionCode(leagueCode);
  const season = deriveSeason(leagueCode, now);
  const withinFreeTierSeason = isWithinApiFootballFreeTierSeasons(season, now);
  const addressable = apiFootballId !== undefined;
  const primarySource: DataSource = addressable ? 'api-football' : 'football-data';

  let reason: string;
  if (!addressable) {
    reason = `No API-Football league id mapped for ${leagueCode}`;
  } else if (withinFreeTierSeason) {
    reason = `Season ${season} is inside the free-tier window; live entitlement NOT VERIFIED`;
  } else {
    reason = `Season ${season} requires a paid plan; live entitlement NOT VERIFIED`;
  }

  return {
    leagueCode,
    leagueName: league.leagueName ?? leagueCode,
    apiFootballId,
    footballDataCode,
    season,
    seasonId: deriveSeasonId(leagueCode, now),
    seasonStrategy: seasonStrategy(leagueCode),
    addressable,
    primarySource,
    entitlement: 'NOT_VERIFIED',
    withinFreeTierSeason,
    eligible: addressable,
    reason,
  };
}

export function assessAllLeagueReadiness(leagues: LeagueInput[], now: Date = new Date()): LeagueReadiness[] {
  return leagues.map((league) => assessLeagueReadiness(league, now));
}

export interface ReadinessSummary {
  total: number;
  eligible: number;
  ineligible: number;
  entitlementNotVerified: string[];
  freeTierOnly: string[];
  ineligibleReasons: Array<{ leagueCode: string; reason: string }>;
}

/** Aggregate readiness for reporting. Never throws; a single failure is isolated. */
export function summarizeReadiness(rows: LeagueReadiness[]): ReadinessSummary {
  return {
    total: rows.length,
    eligible: rows.filter((row) => row.eligible).length,
    ineligible: rows.filter((row) => !row.eligible).length,
    entitlementNotVerified: rows.filter((row) => row.entitlement === 'NOT_VERIFIED').map((row) => row.leagueCode),
    freeTierOnly: rows.filter((row) => row.withinFreeTierSeason).map((row) => row.leagueCode),
    ineligibleReasons: rows
      .filter((row) => !row.eligible)
      .map((row) => ({ leagueCode: row.leagueCode, reason: row.reason })),
  };
}
