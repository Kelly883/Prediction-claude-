import type { Fixture, FixtureEnrichment, PlayerRecord, TeamStats } from '@/types/analysis';
import { cachedProviderFetch } from '@/lib/analysis/ingestion/cache';
import { normalizeFootballDataStatus } from '@/lib/analysis/ingestion/status';
import { parseForm, toNumber } from '@/lib/analysis/utils/normalization';
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  ProviderRateLimitError,
  providerErrorFromResponse,
  withBoundedRetry,
} from '@/lib/api/retry';
import {
  assertProviderAvailable,
  recordProviderFailure,
  recordProviderSuccess,
} from '@/lib/api/circuit-breaker';
import { footballDataCompetitionCode, partitionByProviderSupport } from '@/lib/api/provider-mapping';

const BASE_URL = 'https://api.football-data.org/v4';
const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

function retryAfterFromBody(body: string): number | undefined {
  const match = body.match(/wait\s+(\d+)\s+seconds?/i);
  return match ? Number(match[1]) : undefined;
}

async function request<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const apiKey = process.env.FOOTBALL_DATA_API_KEY;
  if (!apiKey) throw new ProviderAuthError('football-data', 401, 'FOOTBALL_DATA_API_KEY is not configured');

  const url = new URL(path.replace(/^\//, ''), `${BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));

  await assertProviderAvailable('football-data');

  return withBoundedRetry('football-data', async () => {
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'X-Auth-Token': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) {
        let body = '';
        try {
          body = typeof response.text === 'function' ? await response.text() : '';
        } catch {
          body = '';
        }
        const headerRetryAfter = typeof response.headers?.get === 'function' ? response.headers.get('retry-after') : null;
        const error = providerErrorFromResponse('football-data', response.status, body, headerRetryAfter);
        if (error instanceof ProviderRateLimitError && error.retryAfterSeconds === undefined) {
          const fromBody = retryAfterFromBody(body);
          if (fromBody !== undefined) throw new ProviderRateLimitError('football-data', error.message, fromBody);
        }
        throw error;
      }
      const payload = await response.json() as T;
      await recordProviderSuccess('football-data');
      return payload;
    } catch (err) {
      if (!(err instanceof ProviderError) || err.recoverable) {
        await recordProviderFailure('football-data');
      }
      throw err;
    }
  });
}

function competitionCodeFor(internalCode: string): string | undefined {
  return footballDataCompetitionCode(internalCode);
}

export function isFootballDataConfigured(): boolean {
  return Boolean(process.env.FOOTBALL_DATA_API_KEY);
}

export async function fetchFootballDataFixtures(leagueCodes: string[], from: string, to: string): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  const errors: string[] = [];
  const { supported, unsupported } = partitionByProviderSupport('football-data', leagueCodes);

  for (const code of unsupported) {
    errors.push(`${code}: league not covered by Football-Data competition mapping`);
  }

  for (const code of supported) {
    const competition = competitionCodeFor(code);
    if (!competition) continue;
    try {
      const payload = await cachedProviderFetch(`football-data:fixtures:${code}:${from}:${to}`, async () => {
        const result = await request<{ matches?: unknown[]; competition?: { name?: string } }>(
          `/competitions/${competition}/matches`,
          {
            dateFrom: `${from}T00:00:00Z`,
            dateTo: `${to}T23:59:59Z`,
          },
        );
        // The v4 `/competitions/{code}/matches` envelope carries the competition
        // at the top level, NOT on each match. Keep it so the normaliser can use
        // it as the league display name.
        return { matches: result.matches ?? [], competitionName: result.competition?.name };
      });
      const entries = Array.isArray(payload?.matches) ? payload.matches : [];
      const competitionName = typeof payload?.competitionName === 'string' ? payload.competitionName : undefined;
      for (const entry of entries) {
        const fixture = normalizeFixture(entry, code, competitionName);
        if (fixture) fixtures.push(fixture);
      }
    } catch (err) {
      if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
      errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fixtures.length === 0 && errors.length > 0) {
    throw new Error(`Football-Data fixtures unavailable: ${errors.join('; ')}`);
  }
  return fixtures;
}

export function normalizeFixture(entry: any, leagueCode: string, competitionName?: string): Fixture | null {
  const kickoff = new Date(entry?.utcDate ?? '');
  if (Number.isNaN(kickoff.getTime())) return null;

  const fixtureId = entry?.id;
  const homeName = entry?.homeTeam?.name;
  const awayName = entry?.awayTeam?.name;
  const homeId = entry?.homeTeam?.id;
  const awayId = entry?.awayTeam?.id;
  // The competition is identified by the already-mapped `leagueCode`. The v4
  // `/competitions/{code}/matches` response does not repeat the competition on
  // each match, so the display name is taken from the match, then the response
  // envelope, then the (verified) code. A fixture is still rejected outright if
  // its teams, id or kickoff are missing.
  const leagueName = entry?.competition?.name ?? competitionName ?? leagueCode;

  // Identity, teams and kickoff must all be present.
  if (fixtureId === undefined || fixtureId === null || String(fixtureId).trim() === '') return null;
  if (!homeName || !awayName) return null;
  if (homeId === undefined || homeId === null || awayId === undefined || awayId === null) return null;
  if (!leagueName) return null;

  const { status, label } = normalizeFootballDataStatus(entry?.status);

  return {
    id: String(fixtureId),
    leagueCode,
    leagueName: String(leagueName),
    kickoff,
    homeTeam: String(homeName),
    awayTeam: String(awayName),
    homeTeamId: String(homeId),
    awayTeamId: String(awayId),
    status,
    statusLabel: label,
    source: 'football-data',
  };
}

export async function fetchFootballDataEnrichment(fixture: Fixture): Promise<FixtureEnrichment> {
  const errors: string[] = [];
  const safe = async <T>(label: string, loader: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await loader();
    } catch (err) {
      // Entitlement exhaustion means the provider is unusable; fail loudly rather
      // than silently degrading the analysis.
      if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
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
  const competition = competitionCodeFor(leagueCode);
  if (!competition) return undefined;
  const payload = await cachedProviderFetch(`football-data:standings:${competition}`, async () => {
    const result = await request<{ standings?: Array<{ table?: unknown[] }> }>(`/competitions/${competition}/standings`);
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
  const competition = competitionCodeFor(leagueCode);
  if (!competition) return undefined;
  const payload = await cachedProviderFetch(`football-data:scorers:${competition}`, async () => {
    const result = await request<{ scorers?: unknown[] }>(`/competitions/${competition}/scorers`, { limit: 5 });
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
