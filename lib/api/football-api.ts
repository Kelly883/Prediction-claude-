import type { Fixture, FixtureEnrichment, H2HRecord, OddsRecord, PlayerRecord, TeamStats } from '@/types/analysis';
import { cachedProviderFetch } from '@/lib/analysis/ingestion/cache';
import { parseForm, toNumber } from '@/lib/analysis/utils/normalization';
import {
  ProviderAuthError,
  ProviderError,
  ProviderQuotaExhaustedError,
  providerErrorFromResponse,
  withBoundedRetry,
} from '@/lib/api/retry';
import {
  assertProviderAvailable,
  recordProviderFailure,
  recordProviderSuccess,
} from '@/lib/api/circuit-breaker';
import { apiFootballLeagueId } from '@/lib/api/provider-mapping';

const BASE_URL = 'https://v3.football.api-sports.io';
const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

interface ApiResponse<T = unknown> {
  response?: T;
  errors?: Record<string, string | string[]>;
}

function classifyApiFootballErrors(errors: Record<string, string | string[]>): ProviderError {
  const flat = Object.entries(errors)
    .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : value}`)
    .join('; ');
  const lower = flat.toLowerCase();

  if (/request limit|quota|daily limit|for the day|out of requests/.test(lower)) {
    return new ProviderQuotaExhaustedError('api-football', `API-Football quota exhausted: ${flat}`);
  }
  if (/token|api[ -]?key|subscription|not subscribed|plan|access|unauthor/.test(lower)) {
    return new ProviderAuthError('api-football', 403, `API-Football entitlement error: ${flat}`);
  }
  return new ProviderError(`API-Football error: ${flat}`, { provider: 'api-football', recoverable: false });
}

async function request<T>(path: string, params: Record<string, string | number> = {}): Promise<ApiResponse<T>> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new ProviderAuthError('api-football', 401, 'API_FOOTBALL_KEY is not configured');

  const url = new URL(path.replace(/^\//, ''), `${BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  await assertProviderAvailable('api-football');

  return withBoundedRetry('api-football', async () => {
    try {
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'x-apisports-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });

      if (!response.ok) {
        let body = '';
        try {
          body = typeof response.text === 'function' ? await response.text() : '';
        } catch {
          body = '';
        }
        const retryAfter = typeof response.headers?.get === 'function' ? response.headers.get('retry-after') : null;
        throw providerErrorFromResponse('api-football', response.status, body, retryAfter);
      }

      const payload = await response.json() as ApiResponse<T>;
      if (payload.errors && Object.keys(payload.errors).length > 0) {
        throw classifyApiFootballErrors(payload.errors);
      }
      await recordProviderSuccess('api-football');
      return payload;
    } catch (err) {
      // Only recoverable failures (network/5xx/429) count toward opening the
      // circuit; auth/quota errors are surfaced separately and must not be masked.
      if (!(err instanceof ProviderError) || err.recoverable) {
        await recordProviderFailure('api-football');
      }
      throw err;
    }
  });
}

export function isApiFootballConfigured(): boolean {
  return Boolean(process.env.API_FOOTBALL_KEY);
}

export async function fetchApiFootballFixtures(leagueCodes: string[], from: string, to: string): Promise<Fixture[]> {
  const fixtures: Fixture[] = [];
  const errors: string[] = [];

  for (const code of leagueCodes) {
    const leagueId = apiFootballLeagueId(code);
    if (!leagueId) {
      errors.push(`${code}: no API-Football league mapping`);
      continue;
    }
    try {
      const payload = await cachedProviderFetch(`api-football:fixtures:${code}:${from}:${to}`, async () => {
        const result = await request<unknown[]>('/fixtures', { league: leagueId, from, to });
        return result.response ?? [];
      });
      const entries = Array.isArray(payload) ? payload : [];
      for (const entry of entries) {
        const fixture = normalizeFixture(entry, code);
        if (fixture) fixtures.push(fixture);
      }
    } catch (err) {
      if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
      errors.push(`${code}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (fixtures.length === 0 && errors.length > 0) {
    throw new Error(`API-Football fixtures unavailable: ${errors.join('; ')}`);
  }
  return fixtures;
}

function normalizeFixture(entry: any, leagueCode: string): Fixture | null {
  const kickoff = new Date(entry?.fixture?.date ?? '');
  if (Number.isNaN(kickoff.getTime())) return null;
  const homeName = entry?.teams?.home?.name;
  const awayName = entry?.teams?.away?.name;
  if (!homeName || !awayName) return null;
  return {
    id: String(entry.fixture.id),
    leagueCode,
    leagueName: String(entry?.league?.name ?? leagueCode),
    kickoff,
    homeTeam: String(homeName),
    awayTeam: String(awayName),
    homeTeamId: entry?.teams?.home?.id ? String(entry.teams.home.id) : undefined,
    awayTeamId: entry?.teams?.away?.id ? String(entry.teams.away.id) : undefined,
    venueLatitude: toNumber(entry?.fixture?.venue?.lat),
    venueLongitude: toNumber(entry?.fixture?.venue?.long),
    source: 'api-football',
  };
}

export async function fetchApiFootballEnrichment(fixture: Fixture): Promise<FixtureEnrichment> {
  const season = fixture.kickoff.getUTCFullYear();
  const errors: string[] = [];
  const safe = async <T>(label: string, loader: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await loader();
    } catch (err) {
      // Entitlement exhaustion is not a per-endpoint degradation: it means the
      // provider is unusable, so it must fail the run rather than be swallowed.
      if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
      errors.push(`${label}: ${err instanceof Error ? err.message : String(err)}`);
      return undefined;
    }
  };

  const [homeStats, awayStats, h2h, injuries, odds, scorers] = await Promise.all([
    safe('home_stats', () => fetchTeamStats(fixture.homeTeamId, fixture.leagueCode, season)),
    safe('away_stats', () => fetchTeamStats(fixture.awayTeamId, fixture.leagueCode, season)),
    safe('h2h', () => fetchH2H(fixture.homeTeam, fixture.awayTeam, fixture.homeTeamId, fixture.awayTeamId)),
    safe('injuries', () => fetchInjuries(fixture.id, fixture.homeTeamId, fixture.awayTeamId)),
    safe('odds', () => fetchOdds(fixture.id)),
    safe('scorers', () => fetchScorers(fixture.leagueCode, season)),
  ]);

  return {
    homeStats,
    awayStats,
    h2h,
    injuries,
    odds,
    players: scorers,
    errors,
  };
}

async function fetchTeamStats(teamId: string | undefined, leagueCode: string, season: number): Promise<TeamStats | undefined> {
  if (!teamId) return undefined;
  const leagueId = apiFootballLeagueId(leagueCode);
  if (!leagueId) return undefined;
  const payload = await cachedProviderFetch(`api-football:team-stats:${teamId}:${leagueId}:${season}`, async () => {
    const result = await request<unknown>('/teams/statistics', { team: teamId, league: leagueId, season });
    return result.response ?? null;
  });
  return normalizeTeamStats(payload);
}

function normalizeTeamStats(payload: any): TeamStats | undefined {
  if (!payload) return undefined;
  const entries: Array<{ type?: string; value?: unknown }> = Array.isArray(payload.statistics) ? payload.statistics : [];
  const find = (...needles: string[]): number | undefined => {
    const entry = entries.find((item) => {
      const type = (item.type ?? '').toLowerCase();
      return needles.some((needle) => type.includes(needle));
    });
    return toNumber(entry?.value);
  };
  const formEntry = entries.find((item) => (item.type ?? '').toLowerCase().includes('form'));
  const form = parseForm(formEntry?.value);
  const stats: TeamStats = {
    xgFor: find('expected goals', 'xg'),
    goalsFor: find('goals:for', 'goals for', 'goals scored'),
    goalsAgainst: find('goals:against', 'goals against', 'goals conceded'),
    cornersFor: find('corners'),
    cardsFor: find('cards'),
    shotsFor: find('shots on target', 'shots'),
    form,
  };
  return stats;
}

async function fetchH2H(homeTeam: string, awayTeam: string, homeId?: string, awayId?: string): Promise<H2HRecord | undefined> {
  if (!homeId || !awayId) {
    void homeTeam;
    void awayTeam;
    return { matches: 0, homeWins: 0, draws: 0, awayWins: 0, bttsRate: 0.5, over25Rate: 0.5 };
  }
  const payload = await cachedProviderFetch(`api-football:h2h:${homeId}:${awayId}`, async () => {
    const result = await request<unknown[]>('/fixtures/headtohead', { h2h: `${homeId}-${awayId}`, last: 10 });
    return result.response ?? [];
  });
  return normalizeH2H(payload, homeId);
}

function normalizeH2H(entries: unknown[], homeId: string): H2HRecord | undefined {
  if (!Array.isArray(entries) || entries.length === 0) return undefined;
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  let btts = 0;
  let over25 = 0;
  let totalGoals = 0;

  for (const entry of entries) {
    const item = entry as any;
    const homeGoals = toNumber(item?.score?.fulltime?.home);
    const awayGoals = toNumber(item?.score?.fulltime?.away);
    if (homeGoals === undefined || awayGoals === undefined) continue;
    const isHome = String(item?.teams?.home?.id) === homeId;
    const left = isHome ? homeGoals : awayGoals;
    const right = isHome ? awayGoals : homeGoals;
    if (left > right) homeWins += 1;
    else if (left === right) draws += 1;
    else awayWins += 1;
    if (left > 0 && right > 0) btts += 1;
    if (left + right > 2.5) over25 += 1;
    totalGoals += left + right;
  }

  const matches = homeWins + draws + awayWins;
  if (matches === 0) return undefined;
  return {
    matches,
    homeWins,
    draws,
    awayWins,
    bttsRate: btts / matches,
    over25Rate: over25 / matches,
    avgGoals: totalGoals / matches,
  };
}

async function fetchInjuries(fixtureId: string, homeId?: string, awayId?: string): Promise<{ home: number; away: number; keyHome: number; keyAway: number } | undefined> {
  const payload = await cachedProviderFetch(`api-football:injuries:${fixtureId}`, async () => {
    const result = await request<unknown[]>('/injuries', { fixture: fixtureId });
    return result.response ?? [];
  });
  const entries = (Array.isArray(payload) ? payload : []) as any[];
  const countFor = (teamId?: string): number => {
    if (!teamId) return 0;
    return entries
      .filter((entry: any) => String(entry?.team?.id) === teamId)
      .reduce((sum, entry: any) => sum + (Array.isArray(entry?.players) ? entry.players.length : 0), 0);
  };
  return { home: countFor(homeId), away: countFor(awayId), keyHome: 0, keyAway: 0 };
}

interface Bet {
  name?: string;
  values?: Array<{ value?: string; odds?: number | string }>;
}

function findOdds(bets: Bet[], betNames: string[], values: string[]): number | undefined {
  const bet = bets.find((item) => betNames.some((name) => (item.name ?? '').toLowerCase().includes(name)));
  if (!bet?.values) return undefined;
  for (const value of values) {
    const match = bet.values.find((item) => (item.value ?? '').toLowerCase().includes(value));
    const odds = toNumber(match?.odds);
    if (odds) return odds;
  }
  return undefined;
}

/** Parse the numeric handicap line from an Asian-handicap selection value (e.g. "Home -0.5"). */
function parseHandicapLine(bet: Bet | undefined, prefixes: string[]): number | undefined {
  if (!bet?.values) return undefined;
  for (const value of bet.values) {
    const text = (value.value ?? '').toLowerCase();
    if (!prefixes.some((prefix) => text.includes(prefix))) continue;
    const match = text.match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) continue;
    const line = Number(match[0]);
    if (Number.isFinite(line)) return line;
  }
  return undefined;
}

async function fetchOdds(fixtureId: string): Promise<OddsRecord | undefined> {
  const payload = await cachedProviderFetch(`api-football:odds:${fixtureId}`, async () => {
    const result = await request<unknown[]>('/odds', { fixture: fixtureId });
    return result.response ?? [];
  });
  const entries = Array.isArray(payload) ? payload : [];
  const bets: Bet[] = (entries[0] as any)?.bookmakers?.[0]?.bets ?? [];
  if (bets.length === 0) return undefined;
  const asianHandicapBet = bets.find((item) => (item.name ?? '').toLowerCase().includes('asian handicap'));
  const asianHandicapLine = parseHandicapLine(asianHandicapBet, ['home', '-']);
  return {
    matchResult: {
      home: findOdds(bets, ['match winner', 'match result'], ['home', '1']),
      draw: findOdds(bets, ['match winner', 'match result'], ['draw', 'x']),
      away: findOdds(bets, ['match winner', 'match result'], ['away', '2']),
    },
    btts: {
      yes: findOdds(bets, ['both teams', 'btts'], ['yes']),
      no: findOdds(bets, ['both teams', 'btts'], ['no']),
    },
    overUnder25: {
      over: findOdds(bets, ['over/under', 'total goals'], ['over 2.5', 'over']),
      under: findOdds(bets, ['over/under', 'total goals'], ['under 2.5', 'under']),
    },
    asianHandicap: {
      home: findOdds(bets, ['asian handicap'], ['home', '-']),
      away: findOdds(bets, ['asian handicap'], ['away', '+']),
      line: asianHandicapLine,
    },
    doubleChance: {
      homeDraw: findOdds(bets, ['double chance'], ['1x', 'home/draw']),
      drawAway: findOdds(bets, ['double chance'], ['x2', 'draw/away']),
      homeAway: findOdds(bets, ['double chance'], ['12', 'home/away']),
    },
    correctScore: Object.fromEntries(
      ['1-0', '1-1', '2-0', '2-1', '2-2', '0-1', '0-2', '1-2'].map((score) => [
        score,
        findOdds(bets, ['correct score'], [score]),
      ]).filter(([, odds]) => odds !== undefined),
    ) as Record<string, number>,
    firstHalfResult: {
      home: findOdds(bets, ['half time', 'first half'], ['home', '1']),
      draw: findOdds(bets, ['half time', 'first half'], ['draw', 'x']),
      away: findOdds(bets, ['half time', 'first half'], ['away', '2']),
    },
    totalCorners: {
      over: findOdds(bets, ['corners'], ['over']),
      under: findOdds(bets, ['corners'], ['under']),
    },
    totalCards: {
      over: findOdds(bets, ['cards'], ['over']),
      under: findOdds(bets, ['cards'], ['under']),
    },
  };
}

async function fetchScorers(leagueCode: string, season: number): Promise<PlayerRecord[] | undefined> {
  const leagueId = apiFootballLeagueId(leagueCode);
  if (!leagueId) return undefined;
  const payload = await cachedProviderFetch(`api-football:scorers:${leagueId}:${season}`, async () => {
    const result = await request<unknown[]>('/players/topscorers', { league: leagueId, season });
    return result.response ?? [];
  });
  const entries = Array.isArray(payload) ? payload : [];
  return entries.slice(0, 5).map((entry: any) => ({
    name: String(entry?.player?.name ?? 'Unknown'),
    goals: toNumber(entry?.statistics?.[0]?.goals?.total),
    minutes: toNumber(entry?.statistics?.[0]?.games?.minutes),
    penalties: toNumber(entry?.statistics?.[0]?.goals?.penalty),
    position: entry?.player?.position ? String(entry.player.position) : undefined,
  }));
}
