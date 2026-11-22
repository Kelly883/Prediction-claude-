import type { Fixture, FixtureEnrichment, H2HRecord, OddsRecord, PlayerRecord, TeamStats } from '@/types/analysis';
import { cachedProviderFetch } from '@/lib/analysis/ingestion/cache';
import { parseForm, toNumber } from '@/lib/analysis/utils/normalization';
import { normalizeApiFootballStatus } from '@/lib/analysis/ingestion/status';
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
import { deriveSeasonId } from '@/lib/api/season';
import { acquireApiFootballSlot } from '@/lib/api/rate-limiter';
import { captureRateLimitHeaders, storeRateLimitHeaders, API_FOOTBALL_RATE_LIMIT_HEADERS } from '@/lib/api/rate-limit-headers';
import { classifyProviderFailure } from '@/lib/api/failure-classification';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { logger } from '@/lib/logger';

const BASE_URL = 'https://v3.football.api-sports.io';
const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

interface ApiResponse<T = unknown> {
  response?: T;
  errors?: Record<string, string | string[]>;
}

interface RequestOptions {
  /** Invoked with the raw Response so callers can capture response headers. */
  onResponse?: (response: Response) => void;
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

async function request<T>(
  path: string,
  params: Record<string, string | number> = {},
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new ProviderAuthError('api-football', 401, 'API_FOOTBALL_KEY is not configured');

  const url = new URL(path.replace(/^\//, ''), `${BASE_URL}/`);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }

  await assertProviderAvailable('api-football');

  return withBoundedRetry('api-football', async () => {
    const startedAt = Date.now();
    try {
      // Every attempt (including retries) reserves a slot in the shared
      // distributed rate limiter first, so retries cannot bypass the limit.
      await acquireApiFootballSlot();
      // Count the actual outbound HTTP attempt. `provider:requests` is a
      // deprecated alias retained for backward compatibility; `af:httpRequests`
      // is the canonical, provider-namespaced counter (a cache hit never reaches
      // this point, so cache hits are never counted as provider requests).
      void incrProviderMetric('af:httpRequests');
      void incrProviderMetric('provider:requests');
      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json', 'x-apisports-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      options.onResponse?.(response);
      // Capture the documented rate-limit headers so quota monitoring can use
      // them when available (never invented, never treated as zero).
      void storeRateLimitHeaders(captureRateLimitHeaders(response));

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
      void incrProviderMetric('af:success');
      logger.debug('provider.request', {
        provider: 'api-football',
        endpoint: path,
        status: response.status,
        durationMs: Date.now() - startedAt,
      });
      return payload;
    } catch (err) {
      // Only recoverable failures (network/5xx/429) count toward opening the
      // circuit; auth/quota errors are surfaced separately and must not be masked.
      const failure = classifyProviderFailure(err);
      void incrProviderMetric('af:failed');
      if (failure.category === 'rate_limit') void incrProviderMetric('af:429');
      else if (failure.category === 'auth' || failure.category === 'invalid_key') void incrProviderMetric('af:authFailures');
      else if (failure.category === 'quota') void incrProviderMetric('af:quotaFailures');
      logger.warn('provider.request.failed', {
        provider: 'api-football',
        endpoint: path,
        category: failure.category,
        status: failure.status,
        durationMs: Date.now() - startedAt,
      });
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

export function normalizeFixture(entry: any, leagueCode: string): Fixture | null {
  const kickoff = new Date(entry?.fixture?.date ?? '');
  if (Number.isNaN(kickoff.getTime())) return null;

  const fixtureId = entry?.fixture?.id;
  const homeName = entry?.teams?.home?.name;
  const awayName = entry?.teams?.away?.name;
  const homeId = entry?.teams?.home?.id;
  const awayId = entry?.teams?.away?.id;
  const leagueName = entry?.league?.name;

  // Identity, teams, competition and kickoff must all be present, otherwise the
  // fixture cannot be safely attributed, deduplicated or enriched.
  if (fixtureId === undefined || fixtureId === null || String(fixtureId).trim() === '') return null;
  if (!homeName || !awayName) return null;
  if (homeId === undefined || homeId === null || awayId === undefined || awayId === null) return null;
  if (!leagueName) return null;

  const normalized = normalizeApiFootballStatus(entry?.fixture?.status?.short, entry?.fixture?.status?.long);
  const providerSeason = entry?.league?.season;
  const seasonId = providerSeason !== undefined && providerSeason !== null && String(providerSeason).trim() !== ''
    ? String(providerSeason)
    : deriveSeasonId(leagueCode, kickoff);

  return {
    id: String(fixtureId),
    leagueCode,
    leagueName: String(leagueName),
    kickoff,
    homeTeam: String(homeName),
    awayTeam: String(awayName),
    homeTeamId: String(homeId),
    awayTeamId: String(awayId),
    venueLatitude: toNumber(entry?.fixture?.venue?.lat),
    venueLongitude: toNumber(entry?.fixture?.venue?.long),
    status: normalized.status,
    statusReason: normalized.label,
    season: Number(seasonId),
    source: 'api-football',
  };
}

export async function fetchApiFootballEnrichment(fixture: Fixture): Promise<FixtureEnrichment> {
  // Competition-aware season: European split seasons and calendar-year leagues
  // do not share the fixture's UTC year (see lib/api/season.ts).
  const season = fixture.season ?? Number(deriveSeasonId(fixture.leagueCode, fixture.kickoff));
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

/**
 * Normalise an API-Football v3 `/teams/statistics` response.
 *
 * The endpoint returns a nested object with goals, xG, form, cards, corners, shots, etc.
 * All available fields are mapped to TeamStats.
 */
export function normalizeTeamStats(payload: any): TeamStats | undefined {
  if (!payload || typeof payload !== 'object') return undefined;

  const goalsFor = toNumber(payload?.goals?.for?.total);
  const goalsAgainst = toNumber(payload?.goals?.against?.total);
  const xgFor = toNumber(payload?.xG?.for?.total);
  const xgAgainst = toNumber(payload?.xG?.against?.total);
  const form = parseForm(payload?.form);
  const cardsFor = toNumber(payload?.cards?.total?.total);
  const cornersFor = toNumber(payload?.corners?.total?.total);
  const shotsFor = toNumber(payload?.shots?.on?.total);

  const hasAny = goalsFor !== undefined || goalsAgainst !== undefined || xgFor !== undefined || xgAgainst !== undefined || form !== undefined || cardsFor !== undefined || cornersFor !== undefined || shotsFor !== undefined;
  if (!hasAny) return undefined;

  return {
    xgFor,
    xgAgainst,
    goalsFor,
    goalsAgainst,
    form,
    cornersFor,
    cornersAgainst: undefined,
    cardsFor,
    cardsAgainst: undefined,
    shotsFor,
    shotsAgainst: undefined,
    firstHalfGoalsFor: undefined,
    firstHalfGoalsAgainst: undefined,
  };
}

async function fetchH2H(_homeTeam: string, _awayTeam: string, homeId?: string, awayId?: string): Promise<H2HRecord | undefined> {
  // Without both provider team ids we cannot query head-to-head. Return missing
  // rather than a fabricated stub — a stub would be counted as real evidence by
  // the confidence calculation (Stage 7).
  if (!homeId || !awayId) return undefined;
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

async function fetchInjuries(fixtureId: string, homeId?: string, awayId?: string): Promise<{ home: number; away: number } | undefined> {
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
  // `keyHome`/`keyAway` are intentionally omitted: the provider response does
  // not identify "key" players, so a hard-coded 0 would be a synthetic value
  // masquerading as verified evidence (Stage 7).
  return { home: countFor(homeId), away: countFor(awayId) };
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

/** Parse the numeric handicap lines from Asian-handicap selection values (e.g. "Home -0.5", "Away +0.5"). */
function parseHandicapLines(bet: Bet | undefined): { homeLine?: number; awayLine?: number; line?: number } {
  if (!bet?.values) return {};
  let homeLine: number | undefined;
  let awayLine: number | undefined;
  for (const value of bet.values) {
    const text = (value.value ?? '').toLowerCase();
    const match = text.match(/[+-]?\d+(?:\.\d+)?/);
    if (!match) continue;
    const line = Number(match[0]);
    if (!Number.isFinite(line)) continue;
    if (text.includes('home') || text.includes('-')) {
      homeLine = line;
    } else if (text.includes('away') || text.includes('+')) {
      awayLine = line;
    }
  }
  const line = homeLine ?? awayLine;
  return { homeLine, awayLine, line };
}

/** Parse the numeric line from Over/Under selection values (e.g. "Over 9.5"). */
function parseOverUnderLine(bet: Bet | undefined): number | undefined {
  if (!bet?.values) return undefined;
  for (const value of bet.values) {
    const text = (value.value ?? '').toLowerCase();
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
  const bookmakers: any[] = (entries[0] as any)?.bookmakers ?? [];
  const bookmaker = bookmakers[0];
  const bets: Bet[] = bookmaker?.bets ?? [];
  if (bets.length === 0) return undefined;
  const asianHandicapBet = bets.find((item) => (item.name ?? '').toLowerCase().includes('asian handicap'));
  const handicapLines = parseHandicapLines(asianHandicapBet);
  const totalCornersBet = bets.find((item) => (item.name ?? '').toLowerCase().includes('total corners'));
  const totalCardsBet = bets.find((item) => (item.name ?? '').toLowerCase().includes('total cards'));
  const capturedAt = typeof (entries[0] as any)?.update === 'string' ? (entries[0] as any).update : undefined;
  const bookmakerName = typeof bookmaker?.name === 'string' ? bookmaker.name : undefined;
  return {
    provider: 'api-football',
    bookmaker: bookmakerName,
    capturedAt,
    provenance: {
      provider: 'api-football',
      bookmaker: bookmakerName,
      timestamp: capturedAt,
    },
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
      homeLine: handicapLines.homeLine,
      awayLine: handicapLines.awayLine,
      line: handicapLines.line,
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
      line: parseOverUnderLine(totalCornersBet),
    },
    totalCards: {
      over: findOdds(bets, ['cards'], ['over']),
      under: findOdds(bets, ['cards'], ['under']),
      line: parseOverUnderLine(totalCardsBet),
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

/**
 * Documented API-Football `/status` payload (v3). Only the fields we use are
 * typed. Account identity (name/email) is deliberately never read or stored.
 *
 * Per the official docs the `/status` call does NOT count against the daily
 * quota. Field names are taken verbatim from the documentation:
 *   response.subscription.{plan,end,active}
 *   response.requests.{current,limit_day}
 */
export interface ApiFootballProviderStatus {
  plan?: string;
  subscriptionEnd?: string;
  active?: boolean;
  /** `response.requests.current` — requests already consumed today. */
  requestsCurrent?: number;
  /** `response.requests.limit_day` — the daily allocation. */
  requestsLimitDay?: number;
  /** Captured rate-limit response headers (lower-cased names). */
  headers: Record<string, string>;
}

/** Fetch the provider `/status` endpoint (through the global limiter). */
export async function fetchApiFootballStatus(): Promise<ApiFootballProviderStatus> {
  const headers: Record<string, string> = {};
  const payload = await request<{
    subscription?: { plan?: unknown; end?: unknown; active?: unknown };
    requests?: { current?: unknown; limit_day?: unknown };
  }>('/status', {}, {
    onResponse: (response) => {
      for (const name of API_FOOTBALL_RATE_LIMIT_HEADERS) {
        const value = typeof response.headers?.get === 'function' ? response.headers.get(name) : null;
        if (value !== null && value !== undefined && value !== '') headers[name.toLowerCase()] = value;
      }
    },
  });

  const response = payload.response ?? {};
  return {
    plan: typeof response.subscription?.plan === 'string' ? response.subscription.plan : undefined,
    subscriptionEnd: typeof response.subscription?.end === 'string' ? response.subscription.end : undefined,
    active: typeof response.subscription?.active === 'boolean' ? response.subscription.active : undefined,
    requestsCurrent: toNumber(response.requests?.current),
    requestsLimitDay: toNumber(response.requests?.limit_day),
    headers,
  };
}
