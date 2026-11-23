import { beforeEach, describe, expect, it, vi } from 'vitest';
import teamStatisticsResponse from './fixtures/api-football/team-statistics.json';
import fixturesResponse from './fixtures/api-football/fixtures.json';
import oddsResponse from './fixtures/api-football/odds.json';

const mocks = vi.hoisted(() => ({
  cachedProviderFetch: vi.fn(async (_key: string, loader: () => Promise<unknown>) => loader()),
  fetch: vi.fn(),
}));

vi.mock('@/lib/analysis/ingestion/cache', () => ({
  cachedProviderFetch: mocks.cachedProviderFetch,
}));

import { fetchApiFootballEnrichment, fetchApiFootballFixtures } from '@/lib/api/football-api';
import { fetchFootballDataFixtures } from '@/lib/api/football-data';
import { apiFootballSeasonForKickoff } from '@/lib/analysis/leagues';
import { filterPicks, scoreFixture } from '@/lib/analysis/engine';
import { DEFAULT_ANALYSIS_SETTINGS } from '@/lib/analysis/config';
import { enrichFixtures } from '@/lib/analysis/ingestion/enrichment';
import { isPlayableFixture } from '@/lib/analysis/ingestion/fixture-status';
import type { Fixture, FixtureEnrichment } from '@/types/analysis';

function jsonResponse(payload: unknown) {
  return { ok: true, status: 200, json: async () => payload } as unknown as Response;
}

const fixture: Fixture = {
  id: '101',
  leagueCode: 'PL',
  leagueName: 'Premier League',
  kickoff: new Date('2026-11-22T15:00:00.000Z'),
  homeTeam: 'Arsenal',
  awayTeam: 'Chelsea',
  homeTeamId: '33',
  awayTeamId: '1',
  source: 'api-football',
};

describe('Phase 1 data completeness', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.cachedProviderFetch.mockImplementation(async (_key, loader) => loader());
    vi.stubGlobal('fetch', mocks.fetch);
  });

  it('normalizes the documented API-Football team-statistics response', async () => {
    mocks.fetch.mockImplementation((url: string) => {
      if (url.includes('/teams/statistics')) return Promise.resolve(jsonResponse(teamStatisticsResponse));
      return Promise.resolve(jsonResponse({ response: [] }));
    });

    const enrichment = await fetchApiFootballEnrichment({ ...fixture, season: 2019 });

    expect(enrichment.homeStats).toMatchObject({
      goalsFor: 68,
      goalsAgainst: 36,
      xgFor: 65.4,
      xgAgainst: 38.2,
      form: ['W', 'W', 'D', 'L', 'W'],
      cornersFor: 186,
      cardsFor: 62,
      shotsFor: 232,
    });
    const statsUrl = String(mocks.fetch.mock.calls.find(([url]) => String(url).includes('/teams/statistics'))?.[0]);
    expect(new URL(statsUrl).searchParams.get('season')).toBe('2019');
  });

  it('derives calendar-year seasons per league and prefers provider season', async () => {
    expect(apiFootballSeasonForKickoff(new Date('2026-03-15'), 'BRA')).toBe(2026);
    expect(apiFootballSeasonForKickoff(new Date('2026-03-15'), 'J1')).toBe(2026);
    expect(apiFootballSeasonForKickoff(new Date('2026-03-15'), 'MLS')).toBe(2026);
    expect(apiFootballSeasonForKickoff(new Date('2026-03-15'), 'PL')).toBe(2025);
    expect(apiFootballSeasonForKickoff(new Date('2026-06-15'), 'PL')).toBe(2025);

    mocks.fetch.mockResolvedValue(jsonResponse({ response: [] }));
    await fetchApiFootballEnrichment({ ...fixture, season: 2025 });
    const statsUrl = String(mocks.fetch.mock.calls.find(([url]) => String(url).includes('/teams/statistics'))?.[0]);
    expect(new URL(statsUrl).searchParams.get('season')).toBe('2025');
  });

  it('keeps only playable fixture statuses and their reasons', async () => {
    mocks.fetch.mockResolvedValueOnce(jsonResponse(fixturesResponse));
    const fixtures = await fetchApiFootballFixtures(['PL'], '2026-11-21', '2026-11-23');
    const playable = fixtures.filter(isPlayableFixture);

    expect(playable.map((item) => item.id)).toEqual(['101']);
    expect(playable[0]).toMatchObject({ status: 'scheduled', season: 2026 });
    expect(fixtures.find((item) => item.id === '102')).toMatchObject({ status: 'postponed', statusReason: 'Match postponed' });
    expect(fixtures.find((item) => item.id === '103')).toMatchObject({ status: 'finished' });
    expect(isPlayableFixture({ ...fixture, status: 'cancelled' })).toBe(false);

    mocks.fetch.mockResolvedValueOnce(jsonResponse({
      matches: [
        { id: 1, utcDate: '2026-11-22T15:00:00Z', status: 'SCHEDULED', competition: { code: 'PL' }, homeTeam: { id: 1, name: 'A' }, awayTeam: { id: 2, name: 'B' } },
        { id: 2, utcDate: '2026-11-22T17:00:00Z', status: 'POSTPONED', competition: { code: 'PL' }, homeTeam: { id: 3, name: 'C' }, awayTeam: { id: 4, name: 'D' } },
      ],
    }));
    const footballDataFixtures = await fetchFootballDataFixtures(['PL'], '2026-11-21', '2026-11-23');
    const playableFootballData = footballDataFixtures.filter(isPlayableFixture);
    expect(playableFootballData.map((item) => item.id)).toEqual(['1']);
    expect(playableFootballData[0].leagueCode).toBe('PL');
    expect(footballDataFixtures.find((item) => item.id === '2')?.status).toBe('postponed');
  });

  it('parses real odds, bookmaker, line, and timestamp without defaults', async () => {
    mocks.fetch.mockImplementation((url: string) => {
      if (url.includes('/odds')) return Promise.resolve(jsonResponse(oddsResponse));
      return Promise.resolve(jsonResponse({ response: [] }));
    });

    const enrichment = await fetchApiFootballEnrichment(fixture);

    expect(enrichment.odds?.matchResult).toMatchObject({ home: 1.53, draw: 4.2, away: 6.1 });
    expect(enrichment.odds?.doubleChance?.homeAway).toBe(1.21);
    expect(enrichment.odds?.asianHandicap).toMatchObject({ home: 2.05, away: 1.8, homeLine: -1, awayLine: 1 });
    expect(enrichment.odds?.totalCorners?.line).toBe(9.5);
    expect(enrichment.odds?.provenance).toMatchObject({ provider: 'api-football', bookmaker: 'Bet365', timestamp: '2026-11-21T18:12:00Z' });
  });

  it('never emits fabricated odds and never selects an ineligible market', () => {
    const outcome = scoreFixture(fixture, {});
    expect(outcome.scores.every((score) => score.odds === undefined)).toBe(true);
    expect(JSON.stringify(outcome)).not.toContain('1.91');
    expect(filterPicks([outcome], 50)).toHaveLength(0);

    const enriched: FixtureEnrichment = {
      homeStats: { xgFor: 2.4, xgAgainst: 0.6, form: ['W', 'W', 'W'] },
      awayStats: { xgFor: 0.7, xgAgainst: 2.1, form: ['L', 'L', 'L'] },
      h2h: { matches: 8, homeWins: 6, draws: 1, awayWins: 1 },
      odds: { matchResult: { home: 1.45, draw: 4.2, away: 7.1 } },
      dataQuality: 'PRIMARY_PARTIAL',
      sources: [{ provider: 'api-football', fields: ['homeStats', 'awayStats', 'h2h', 'odds'], quality: 'partial' }],
    };
    const gated = scoreFixture(fixture, enriched);
    const disabled = ['FIRST_HALF_RESULT', 'TOTAL_CARDS', 'PLAYER_SCORER'];
    for (const market of disabled) {
      expect(gated.eligibility.find((item) => item.market === market)).toMatchObject({ eligible: false, proceed: false });
    }
    expect(gated.eligibility.find((item) => item.market === 'TOTAL_CORNERS')).toMatchObject({ eligible: false, proceed: false });
    expect(gated.best?.market).not.toBe('TOTAL_CARDS');
  });

  it('classifies fallback quality and attaches evidence labels', async () => {
    const result = await enrichFixtures([fixture], {
      threshold: 75,
      marketWeights: DEFAULT_ANALYSIS_SETTINGS.marketWeights,
      dataSourcePriorities: ['api-football', 'football-data'],
    }, {
      loadEnrichment: async (provider) => provider === 'api-football'
        ? {}
        : { homeStats: { goalsFor: 2 }, awayStats: { goalsFor: 1 }, dataQuality: 'PRIMARY_PARTIAL' },
      fetchWeather: async () => undefined,
    });

    expect(result[0].enrichment.dataQuality).toBe('FALLBACK_PARTIAL');
    expect(result[0].enrichment.sources?.map((source) => source.provider)).toContain('football-data');
    const outcome = scoreFixture(fixture, result[0].enrichment);
    expect(outcome.evidenceLabel).toBe('ESTIMATED');
    expect(outcome.scores[0].confidenceLabel).toBe('HEURISTIC_MODEL_SCORE');
    expect(outcome.scores[0]?.evidence?.label).toBe('ESTIMATED');
  });
});
