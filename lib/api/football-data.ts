import type { Fixture, FixtureEnrichment, PlayerRecord, TeamStats } from '@/types/analysis';
import { cachedProviderFetch } from '@/lib/analysis/ingestion/cache';
import { parseForm, toNumber } from '@/lib/analysis/utils/normalization';

const BASE_URL = 'https://api.football-data.org/v4';
const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

async function request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new Error('FOOTBALL_DATA_API_KEY is not configured');

  const url = new URL(path.replace(/^\//, ''), `${BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  const response = await fetch(url.toString(), {
    headers: { Accept: 'application/json', 'X-Auth-Token': apiKey },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`Football-Data request failed: ${response.status}`);
  return await response.json() as T;
}

export function isFootballDataConfigured(): boolean {
  return Boolean(process.env.FOOTBALL_DATA_API_KEY);
}

export async function fetchFootballDataFixtures(leagueCodes: string[], from: string, to: string): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  const errors: string[] = [];

  for (const code of leagueCodes) {
    try {
      const payload = await cachedProviderFetch(`football-data:fixtures:${code}:${from}:${to}`, async () => {
        const result = await request<{ matches?: unknown[] }>(`/competitions/${code}/matches`, {
          dateFrom: `${from}T00:00:00Z`,
          dateTo: `${to}T23:59:59Z`,
        });
        return result.matches ?? [];
      });
      const entries = Array.isArray(payload) ? payload : [];
      for (const entry of entries) {
        const fixture = normalizeFixture(entry, code);
        if (fixture) fixtures.push(fixture);
      }
    } catch (err) {
      errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fixtures.length === 0 && errors.length > 0) {
    throw new Error(`Football-Data fixtures unavailable: ${errors.join('; ')}`);
  }
  return fixtures;
}

function normalizeFixture(entry: any, leagueCode: string): Fixture | null {
  const kickoff = new Date(entry?.utcDate ?? '');
  if (Number.isNaN(kickoff.getTime())) return null;
  const homeName = entry?.homeTeam?.name;
  const awayName = entry?.awayTeam?.name;
  if (!homeName || !awayName) return null;
  return {
    id: String(entry.id),
    leagueCode: String(entry?.competition?.code ?? leagueCode),
    leagueName: String(entry?.competition?.name ?? leagueCode),
    kickoff,
    homeTeam: String(homeName),
    awayTeam: String(awayName),
    homeTeamId: entry?.homeTeam?.id ? String(entry.homeTeam.id) : undefined,
    awayTeamId: entry?.awayTeam?.id ? String(entry.awayTeam.id) : undefined,
    source: 'football-data',
  };
}

export async function fetchFootballDataEnrichment(fixture: Fixture): Promise<FixtureEnrichment> {
  const errors: string[] = [];
  const safe = async <T>(label: string, loader: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await loader();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };

  const [standings, scorers] = await Promise.all([
    safe('standings', () => fetchStandings(fixture.leagueCode)),
    safe('scorers', () => fetchScorers(fixture.leagueCode)),
  ]);

  const table = standings?.table ?? [];
  const homeStats = teamStatsFromTable(table, fixture.homeTeamId, fixture.homeTeam);
  const awayStats = teamStatsFromTable(table, fixture.awayTeamId, fixture.awayTeam);
  const played = table.reduce((sum, row) => sum + (row.played ?? 0), 0);
  const goals = table.reduce((sum, row) => sum + (row.goalsFor ?? 0), 0);

  return {
    homeStats,
    awayStats,
    players: scorers,
    leagueAvgGoals: played > 0 ? goals / (played / 2) : undefined,
    errors,
  };
}

interface StandingRow {
  teamId?: string;
  teamName?: string;
  played?: number;
  goalsFor?: number;
  goalsAgainst?: number;
  form?: string[];
  cornersFor?: number;
  cardsFor?: number;
}

async function fetchStandings(leagueCode: string): Promise<{ table: StandingRow[] } | undefined> {
  const payload = await cachedProviderFetch(`football-data:standings:${leagueCode}`, async () => {
    const result = await request<{ standings?: Array<{ table?: unknown[] }> }>(`/competitions/${leagueCode}/standings`);
    return result.standings?.[0]?.table ?? [];
  });
  const entries = Array.isArray(payload) ? payload : [];
  return {
    table: entries.map((entry: any) => ({
      teamId: entry?.team?.id ? String(entry.team.id) : undefined,
      teamName: String(entry?.team?.name ?? ''),
      played: toNumber(entry?.playedGames),
      goalsFor: toNumber(entry?.goalsFor),
      goalsAgainst: toNumber(entry?.goalsAgainst),
      form: parseForm(entry?.form),
    })),
  };
}

function teamStatsFromTable(table: StandingRow[], teamId: string | undefined, teamName: string): TeamStats | undefined {
  const row = table.find((item) => (teamId && item.teamId === teamId) || item.teamName === teamName);
  if (!row) return undefined;
  return {
    goalsFor: row.goalsFor,
    goalsAgainst: row.goalsAgainst,
    form: row.form,
  };
}

async function fetchScorers(leagueCode: string): Promise<PlayerRecord[] | undefined> {
  const payload = await cachedProviderFetch(`football-data:scorers:${leagueCode}`, async () => {
    const result = await request<{ scorers?: unknown[] }>(`/competitions/${leagueCode}/scorers`, { limit: 5 });
    return result.scorers ?? [];
  });
  const entries = Array.isArray(payload) ? payload : [];
  return entries.slice(0, 5).map((entry: any) => ({
    name: String(entry?.player?.name ?? 'Unknown'),
    goals: toNumber(entry?.goals),
    minutes: toNumber(entry?.minutesPlayed),
    penalties: toNumber(entry?.penalties),
    position: entry?.player?.position ? String(entry.player.position) : undefined,
  }));
}
