import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  cachedProviderFetch: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
  fetch: vi.fn(),
}));

vi.mock('@/lib/analysis/ingestion/cache', () => ({
  cachedProviderFetch: mocks.cachedProviderFetch,
}));

import {
  fetchApiFootballEnrichment,
  fetchApiFootballFixtures,
} from '@/lib/api/football-api';
import {
  fetchFootballDataEnrichment,
  fetchFootballDataFixtures,
} from '@/lib/api/football-data';

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
  } as unknown as Response;
}

describe('football provider adapters', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.cachedProviderFetch.mockImplementation(async (_key, loader) => loader());
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('normalizes API-Football fixtures and sends its API key header', async () => {
    mocks.fetch
      .mockResolvedValueOnce(jsonResponse({ response: [{ league: { id: 39 } }] }))
      .mockResolvedValueOnce(jsonResponse({
        response: [{
          fixture: {
            id: 101,
            date: '2026-11-22T15:00:00Z',
            venue: { lat: 51.5, long: -0.1 },
          },
          league: { name: 'Premier League' },
          teams: { home: { id: 1, name: 'Arsenal' }, away: { id: 2, name: 'Chelsea' } },
        }],
      }));

    const fixtures = await fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23');

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: '101',
      leagueCode: 'PL',
      leagueName: 'Premier League',
      homeTeam: 'Arsenal',
      awayTeam: 'Chelsea',
      homeTeamId: '1',
      awayTeamId: '2',
      source: 'api-football',
    });
    expect(fixtures[0].venueLatitude).toBe(51.5);
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({
      'x-apisports-key': 'test-api-football-key',
    });
  });

  it('normalizes Football-Data fixtures and sends its auth token header', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      matches: [{
        id: 202,
        utcDate: '2026-11-22T17:30:00Z',
        competition: { code: 'PD', name: 'LaLiga' },
        homeTeam: { id: 11, name: 'Real Madrid' },
        awayTeam: { id: 12, name: 'Barcelona' },
      }],
    }));

    const fixtures = await fetchFootballDataFixtures(['PD'], '2026-11-21', '2026-11-23');

    expect(fixtures).toHaveLength(1);
    expect(fixtures[0]).toMatchObject({
      id: '202',
      leagueCode: 'PD',
      leagueName: 'LaLiga',
      homeTeam: 'Real Madrid',
      awayTeam: 'Barcelona',
      source: 'football-data',
    });
    expect(mocks.fetch.mock.calls[0][1].headers).toMatchObject({
      'X-Auth-Token': 'test-football-data-key',
    });
  });

  it('surfaces provider errors when no fixtures can be loaded', async () => {
    mocks.fetch.mockRejectedValue(new Error('network down'));

    await expect(fetchFootballDataFixtures(['PL'], '2026-11-21', '2026-11-23'))
      .rejects.toThrow('Football-Data fixtures unavailable');
  });

  it('keeps enrichment usable when one upstream call fails', async () => {
    const fixture = {
      id: '303',
      leagueCode: 'PD',
      leagueName: 'LaLiga',
      kickoff: new Date('2026-11-22T20:00:00Z'),
      homeTeam: 'Sevilla',
      awayTeam: 'Betis',
      source: 'api-football' as const,
    };

    mocks.fetch.mockImplementation((url: string) => {
      if (url.includes('/standings')) {
        return Promise.resolve(jsonResponse({
          standings: [{
            table: [
              { team: { id: 21, name: 'Sevilla' }, playedGames: 10, goalsFor: 18, goalsAgainst: 9, form: 'WWWDW' },
              { team: { id: 22, name: 'Betis' }, playedGames: 10, goalsFor: 14, goalsAgainst: 11, form: 'WLWDW' },
            ],
          }],
        }));
      }
      return Promise.reject(new Error('scorers unavailable'));
    });

    const enrichment = await fetchFootballDataEnrichment(fixture);

    expect(enrichment.homeStats?.goalsFor).toBe(18);
    expect(enrichment.awayStats?.goalsFor).toBe(14);
    expect(enrichment.players).toBeUndefined();
    expect((enrichment.errors ?? []).join(' ')).toContain('scorers');
  });

  it('collects API-Football enrichment errors without throwing', async () => {
    const fixture = {
      id: '404',
      leagueCode: 'PL',
      leagueName: 'Premier League',
      kickoff: new Date('2026-11-23T15:00:00Z'),
      homeTeam: 'Liverpool',
      awayTeam: 'Everton',
      source: 'api-football' as const,
    };

    mocks.fetch.mockRejectedValue(new Error('upstream down'));

    const enrichment = await fetchApiFootballEnrichment(fixture);

    expect((enrichment.errors ?? []).length).toBeGreaterThan(0);
    expect(enrichment.homeStats).toBeUndefined();
  });
});
