import { prisma } from '@/lib/prisma';
import type { AnalysisSettings, DataSource, Fixture, LeagueConfigRecord } from '@/types/analysis';
import { fetchApiFootballFixtures } from '@/lib/api/football-api';
import { fetchFootballDataFixtures } from '@/lib/api/football-data';

export const FIXTURE_WINDOW_HOURS = 48;

export function dateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function fixtureWindow(now = new Date()): { from: string; to: string } {
  return {
    from: dateOnly(now),
    to: dateOnly(new Date(now.getTime() + FIXTURE_WINDOW_HOURS * 60 * 60 * 1000)),
  };
}

export async function getEnabledLeagues(): Promise<LeagueConfigRecord[]> {
  return prisma.leagueConfig.findMany({
    where: { isEnabled: true },
    orderBy: [{ priority: 'asc' }, { leagueCode: 'asc' }],
    select: { id: true, leagueName: true, leagueCode: true, isEnabled: true, priority: true },
  });
}

export async function fetchFixtures(
  leagues: LeagueConfigRecord[],
  settings: AnalysisSettings,
  now = new Date(),
): Promise<{ fixtures: Fixture[]; errors: string[] }> {
  const codes = leagues.map((league) => league.leagueCode);
  const { from, to } = fixtureWindow(now);
  const errors: string[] = [];
  const providers = settings.dataSourcePriorities;

  for (const provider of providers) {
    try {
      const fixtures = await loadFromProvider(provider, codes, from, to);
      return { fixtures: dedupeFixtures(fixtures), errors };
    } catch (err) {
      errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  throw new Error(`All fixture providers failed: ${errors.join('; ')}`);
}

async function loadFromProvider(provider: DataSource, codes: string[], from: string, to: string): Promise<Fixture[]> {
  if (provider === 'api-football') return fetchApiFootballFixtures(codes, from, to);
  return fetchFootballDataFixtures(codes, from, to);
}

function dedupeFixtures(fixtures: Fixture[]): Fixture[] {
  const seen = new Set<string>();
  return fixtures.filter((fixture) => {
    const key = `${fixture.source}:${fixture.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
