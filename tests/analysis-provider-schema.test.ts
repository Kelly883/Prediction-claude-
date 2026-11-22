import { describe, expect, it } from 'vitest';

import { normalizeFixture as normalizeApiFootballFixture, normalizeTeamStats } from '@/lib/api/football-api';
import { normalizeFixture as normalizeFootballDataFixture } from '@/lib/api/football-data';

import teamStatisticsSample from './fixtures/api-football/team-statistics.sample.json';
import apiFootballFixturesSample from './fixtures/api-football/fixtures.sample.json';
import footballDataFixturesSample from './fixtures/football-data/fixtures.sample.json';

/**
 * Stage 1 regression: the adapters must map the ACTUAL provider response
 * structure, not an assumed one. These tests run against sanitized captures
 * kept in tests/fixtures/**.
 *
 * Evidence label: the fixture shapes mirror the documented API-Football v3 and
 * Football-Data.org v4 schemas. Live-call verification is NOT VERIFIED (no
 * authorized live request was made) — see the remediation report.
 */
describe('API-Football /teams/statistics normaliser (Stage 1.1)', () => {
  const response = (teamStatisticsSample as any).response;

  it('maps the nested v3 object shape (goals.for.total.total, form, cards)', () => {
    const stats = normalizeTeamStats(response);
    expect(stats).toBeDefined();
    expect(stats?.goalsFor).toBe(19);
    expect(stats?.goalsAgainst).toBe(10);
    expect(stats?.form).toEqual(['W', 'W', 'D', 'L', 'W']);
    // yellow 1+2+1+2+3+2 = 11, red 0+0+0+1+0+1 = 2 → 13
    expect(stats?.cardsFor).toBe(13);
  });

  it('leaves fields the endpoint does not provide as MISSING (not zero)', () => {
    const stats = normalizeTeamStats(response);
    expect(stats?.xgFor).toBeUndefined();
    expect(stats?.xgAgainst).toBeUndefined();
    expect(stats?.cornersFor).toBeUndefined();
    expect(stats?.shotsFor).toBeUndefined();
  });

  it('keeps legitimate zero values distinguishable from missing values', () => {
    const zeroed = normalizeTeamStats({
      goals: { for: { total: { total: 0 } }, against: { total: { total: 0 } } },
      form: null,
      cards: {},
    });
    expect(zeroed).toBeDefined();
    expect(zeroed?.goalsFor).toBe(0);
    expect(zeroed?.goalsAgainst).toBe(0);
    expect(zeroed?.form).toBeUndefined();
    expect(zeroed?.cardsFor).toBeUndefined();
  });

  it('returns undefined for empty, null or malformed payloads', () => {
    expect(normalizeTeamStats(undefined)).toBeUndefined();
    expect(normalizeTeamStats(null)).toBeUndefined();
    expect(normalizeTeamStats('nonsense')).toBeUndefined();
    expect(normalizeTeamStats({})).toBeUndefined();
    expect(normalizeTeamStats({ goals: { for: { total: { total: 'abc' } } } })).toBeUndefined();
  });

  it('still maps cards when goals are absent', () => {
    const stats = normalizeTeamStats({
      cards: { yellow: { '0-15': { total: 2 } }, red: { '46-60': { total: 1 } } },
    });
    expect(stats?.cardsFor).toBe(3);
    expect(stats?.goalsFor).toBeUndefined();
  });

  it('does NOT parse the /fixtures/statistics array shape as team statistics', () => {
    // The old normaliser wrongly expected `statistics: [{type,value}]`; that
    // shape belongs to /fixtures/statistics and must not map here.
    const wrongShape = { statistics: [{ type: 'Total Shots', value: 12 }] };
    expect(normalizeTeamStats(wrongShape)).toBeUndefined();
  });
});

describe('API-Football /fixtures normaliser (Stage 1.2)', () => {
  const entries = (apiFootballFixturesSample as any).response as any[];

  it('maps a valid scheduled fixture with identity, league, kickoff, venue and season', () => {
    const fixture = normalizeApiFootballFixture(entries[0], 'PL');
    expect(fixture).not.toBeNull();
    expect(fixture).toMatchObject({
      id: '500001',
      leagueCode: 'PL',
      leagueName: 'Premier League',
      homeTeam: 'Sample United',
      awayTeam: 'Sample City',
      homeTeamId: '1001',
      awayTeamId: '1002',
      status: 'scheduled',
      statusLabel: 'NS',
      seasonId: '2026',
      source: 'api-football',
    });
    expect(fixture?.kickoff.toISOString()).toBe('2026-11-22T15:00:00.000Z');
  });

  it('normalises postponed and finished statuses', () => {
    expect(normalizeApiFootballFixture(entries[1], 'PL')?.status).toBe('postponed');
    expect(normalizeApiFootballFixture(entries[2], 'PL')?.status).toBe('finished');
  });

  it('rejects a fixture missing team identity', () => {
    expect(normalizeApiFootballFixture(entries[3], 'PL')).toBeNull();
  });

  it('rejects a fixture with an unparseable kickoff', () => {
    expect(normalizeApiFootballFixture({ fixture: { id: 1, date: 'not-a-date' }, league: { name: 'X' }, teams: { home: { id: 1, name: 'A' }, away: { id: 2, name: 'B' } } }, 'PL')).toBeNull();
  });
});

describe('Football-Data.org /matches normaliser (Stage 1.2)', () => {
  const matches = (footballDataFixturesSample as any).matches as any[];
  const competitionName = (footballDataFixturesSample as any).competition?.name as string;

  it('maps a valid fixture and normalises TIMED to scheduled', () => {
    // The real v4 envelope carries the competition at the top level; the adapter
    // receives it explicitly (never inventing one).
    const fixture = normalizeFootballDataFixture(matches[0], 'PD', competitionName);
    expect(fixture).toMatchObject({
      id: '700001',
      leagueCode: 'PD',
      leagueName: 'Primera Division',
      homeTeam: 'Sample CF',
      awayTeam: 'Sample Real',
      status: 'scheduled',
      source: 'football-data',
    });
  });

  it('falls back to the mapped competition code when the envelope name is absent', () => {
    // A fixture is never accepted for an unmapped competition: the caller only
    // iterates mapped codes, so the code itself is a valid competition identity.
    const fixture = normalizeFootballDataFixture(matches[0], 'PD');
    expect(fixture?.leagueName).toBe('PD');
  });

  it('normalises POSTPONED and rejects a fixture missing home team id', () => {
    expect(normalizeFootballDataFixture(matches[1], 'PD', competitionName)?.status).toBe('postponed');
    expect(normalizeFootballDataFixture(matches[2], 'PD', competitionName)).toBeNull();
  });
});
