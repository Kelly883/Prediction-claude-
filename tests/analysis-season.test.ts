import { describe, expect, it } from 'vitest';

import { deriveSeason, deriveSeasonId, seasonStrategy } from '@/lib/api/season';
import { isWithinApiFootballFreeTierSeasons } from '@/lib/api/provider-mapping';
import {
  assessAllLeagueReadiness,
  assessLeagueReadiness,
  summarizeReadiness,
} from '@/lib/analysis/ingestion/readiness';
import { LEAGUES } from '@/lib/analysis/config';

const ASSESS_AT = new Date('2026-11-22T00:00:00.000Z');

describe('competition-aware season derivation (Stage 2)', () => {
  it('classifies split vs calendar-year competitions', () => {
    expect(seasonStrategy('PL')).toBe('split');
    expect(seasonStrategy('CL')).toBe('split');
    for (const code of ['MLS', 'J1', 'BRA', 'ARG', 'LIB']) {
      expect(seasonStrategy(code)).toBe('calendar');
    }
  });

  it('derives split-season start year from the kickoff month', () => {
    // August 2026 is the start of the 2026/27 season.
    expect(deriveSeason('PL', new Date('2026-08-01T00:00:00.000Z'))).toBe(2026);
    // February 2026 still belongs to the season that started in 2025.
    expect(deriveSeason('PL', new Date('2026-02-01T00:00:00.000Z'))).toBe(2025);
    // January 2027 still belongs to the season that started in 2026.
    expect(deriveSeason('PL', new Date('2027-01-15T00:00:00.000Z'))).toBe(2026);
  });

  it('derives calendar-year seasons from the kickoff year', () => {
    expect(deriveSeason('MLS', new Date('2026-06-15T00:00:00.000Z'))).toBe(2026);
    expect(deriveSeason('BRA', new Date('2026-11-30T00:00:00.000Z'))).toBe(2026);
    expect(deriveSeasonId('PL', new Date('2026-11-22T00:00:00.000Z'))).toBe('2026');
  });

  it('reports the API-Football free-tier season window', () => {
    expect(isWithinApiFootballFreeTierSeasons(2024, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    expect(isWithinApiFootballFreeTierSeasons(2023, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    expect(isWithinApiFootballFreeTierSeasons(2022, new Date('2026-06-01T00:00:00.000Z'))).toBe(true);
    // Current season needs a paid plan.
    expect(isWithinApiFootballFreeTierSeasons(2026, new Date('2026-06-01T00:00:00.000Z'))).toBe(false);
    expect(isWithinApiFootballFreeTierSeasons(2021, new Date('2026-06-01T00:00:00.000Z'))).toBe(false);
  });
});

describe('league readiness (Stage 2)', () => {
  it('marks a mapped league eligible but never assumes live entitlement', () => {
    const readiness = assessLeagueReadiness({ leagueCode: 'PL', leagueName: 'Premier League' }, ASSESS_AT);
    expect(readiness.apiFootballId).toBe(39);
    expect(readiness.footballDataCode).toBe('PL');
    expect(readiness.season).toBe(2026);
    expect(readiness.seasonId).toBe('2026');
    expect(readiness.seasonStrategy).toBe('split');
    expect(readiness.addressable).toBe(true);
    expect(readiness.primarySource).toBe('api-football');
    expect(readiness.eligible).toBe(true);
    // Entitlement is only VERIFIED by a live probe; there is none here.
    expect(readiness.entitlement).toBe('NOT_VERIFIED');
    expect(readiness.reason).toMatch(/NOT VERIFIED/);
  });

  it('marks an unmapped competition ineligible with a clear reason', () => {
    const readiness = assessLeagueReadiness({ leagueCode: 'XYZ' }, ASSESS_AT);
    expect(readiness.addressable).toBe(false);
    expect(readiness.eligible).toBe(false);
    expect(readiness.apiFootballId).toBeUndefined();
    expect(readiness.reason).toMatch(/No API-Football league id/);
  });

  it('assesses all 20 configured leagues without disabling the rest when one fails', () => {
    const rows = assessAllLeagueReadiness([...LEAGUES], ASSESS_AT);
    expect(rows).toHaveLength(20);
    expect(rows.every((row) => row.entitlement === 'NOT_VERIFIED')).toBe(true);

    const mixed = summarizeReadiness(assessAllLeagueReadiness([{ leagueCode: 'PL' }, { leagueCode: 'XYZ' }, { leagueCode: 'PD' }], ASSESS_AT));
    expect(mixed.total).toBe(3);
    expect(mixed.eligible).toBe(2);
    expect(mixed.ineligible).toBe(1);
    expect(mixed.ineligibleReasons).toEqual([{ leagueCode: 'XYZ', reason: expect.stringMatching(/No API-Football league id/) }]);
  });
});
