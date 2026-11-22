/**
 * Enrichment data-quality classification (Stage 6).
 *
 * The primary provider (API-Football) supplies the full set of inputs the
 * ten-market engine expects. The fallback provider (Football-Data.org) supplies
 * only fixtures, standings-derived scoring/conceding and form — NOT xG, corners,
 * odds, injuries, first-half splits or verified line-ups. Fallback enrichment is
 * therefore NOT equivalent to primary enrichment, and must never be presented as
 * if a fixture had complete data.
 *
 * This module classifies what was actually obtained and lists what is missing,
 * so market eligibility can be tightened and administrators can see the reason.
 */
import type { DataSource, EnrichmentQuality, FixtureEnrichment } from '@/types/analysis';

/** Input groups the engine draws on, used to measure completeness. */
const GROUPS: Array<{ label: string; present: (enrichment: FixtureEnrichment) => boolean }> = [
  { label: 'homeStats', present: (e) => e.homeStats !== undefined },
  { label: 'awayStats', present: (e) => e.awayStats !== undefined },
  { label: 'odds', present: (e) => e.odds !== undefined && Object.keys(e.odds).length > 0 },
  { label: 'h2h', present: (e) => e.h2h !== undefined },
  { label: 'injuries', present: (e) => e.injuries !== undefined },
  { label: 'players', present: (e) => Array.isArray(e.players) && e.players.length > 0 },
];

export interface EnrichmentClassification {
  quality: EnrichmentQuality;
  missingFields: string[];
}

/**
 * Classify enrichment produced by a given provider.
 *
 * - API-Football with every group → PRIMARY_COMPLETE
 * - API-Football with some groups → PRIMARY_PARTIAL
 * - Football-Data with team stats → FALLBACK_PARTIAL
 * - Nothing usable → INSUFFICIENT_DATA
 */
export function classifyEnrichment(provider: DataSource, enrichment: FixtureEnrichment): EnrichmentClassification {
  const missingFields = GROUPS.filter((group) => !group.present(enrichment)).map((group) => group.label);
  const hasTeamStats = enrichment.homeStats !== undefined || enrichment.awayStats !== undefined;
  const usable = hasTeamStats || enrichment.odds !== undefined || enrichment.h2h !== undefined
    || (enrichment.players?.length ?? 0) > 0;

  if (!usable) return { quality: 'INSUFFICIENT_DATA', missingFields };

  if (provider === 'api-football') {
    return { quality: missingFields.length === 0 ? 'PRIMARY_COMPLETE' : 'PRIMARY_PARTIAL', missingFields };
  }

  // Football-Data.org never supplies odds/h2h/injuries/xG/first-half/corners in
  // this integration, so it is always at best FALLBACK_PARTIAL.
  return { quality: hasTeamStats ? 'FALLBACK_PARTIAL' : 'INSUFFICIENT_DATA', missingFields };
}

/** Human-readable description of a quality label, for admin surfaces. */
export function describeQuality(quality: EnrichmentQuality): string {
  switch (quality) {
    case 'PRIMARY_COMPLETE':
      return 'Primary provider supplied all required enrichment';
    case 'PRIMARY_PARTIAL':
      return 'Primary provider enrichment is incomplete';
    case 'FALLBACK_PARTIAL':
      return 'Fallback provider only — reduced data, fewer markets eligible';
    default:
      return 'Insufficient data — no reliable enrichment available';
  }
}
