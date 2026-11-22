/**
 * Competition-aware season derivation.
 *
 * A provider "season" is NOT always the fixture's UTC calendar year. European
 * leagues and UEFA competitions run autumn→spring (a "split" season that starts
 * in the second half of the calendar year), whereas leagues in the Americas and
 * Japan run within a single calendar year. Sending the wrong season to
 * `/teams/statistics` (or `/players/topscorers`) returns no data, which would
 * silently starve the ten-market engine.
 *
 * This module derives the season identifier from the fixture kickoff and the
 * competition's scheduling convention. It is intentionally a static, documented
 * table — entitlement to serve a given season is a separate concern (see
 * `lib/analysis/ingestion/readiness.ts`) and is NOT assumed here.
 */

/** How a competition's season aligns to the calendar. */
export type SeasonStrategy = 'split' | 'calendar';

/** First month (0-indexed) of a split season. European seasons start in July. */
const SPLIT_SEASON_START_MONTH = 6; // July

/**
 * Competitions that run within a single calendar year. Every other product
 * league is treated as a split (autumn→spring) season.
 */
const CALENDAR_YEAR_LEAGUES: ReadonlySet<string> = new Set([
  'MLS', // Major League Soccer (Feb–Oct)
  'J1', // Japan J1 League (Feb–Dec)
  'BRA', // Brazil Série A (Apr–Dec)
  'ARG', // Argentina Primera División (calendar-year tournament)
  'LIB', // Liga MX (Apertura + Clausura within one season year)
]);

/** Season scheduling convention for an internal league code. */
export function seasonStrategy(leagueCode: string): SeasonStrategy {
  return CALENDAR_YEAR_LEAGUES.has(leagueCode.trim().toUpperCase()) ? 'calendar' : 'split';
}

/**
 * Derive the provider season identifier (the season's start year) for a fixture.
 *
 * - calendar leagues: the kickoff's UTC calendar year.
 * - split leagues:   the year the season started — the kickoff year for
 *   kickoffs from July onward, otherwise the previous year.
 */
export function deriveSeason(leagueCode: string, kickoff: Date): number {
  const year = kickoff.getUTCFullYear();
  if (seasonStrategy(leagueCode) === 'calendar') return year;
  return kickoff.getUTCMonth() >= SPLIT_SEASON_START_MONTH ? year : year - 1;
}

/** Derived season as the string identifier sent to providers. */
export function deriveSeasonId(leagueCode: string, kickoff: Date): string {
  return String(deriveSeason(leagueCode, kickoff));
}
