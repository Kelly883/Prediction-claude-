import type { AnalysisSettings, Fixture, FixtureEnrichment } from '@/types/analysis';
import { fetchApiFootballEnrichment } from '@/lib/api/football-api';
import { fetchFootballDataEnrichment } from '@/lib/api/football-data';
import { fetchWeather } from './weather';

const MAX_CONCURRENCY = 10;

export async function mapWithConcurrency<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index], index);
    }
  });

  await Promise.all(runners);
  return results;
}

export async function enrichFixtures(
  fixtures: Fixture[],
  settings: AnalysisSettings,
): Promise<Array<{ fixture: Fixture; enrichment: FixtureEnrichment }>> {
  return mapWithConcurrency(fixtures, MAX_CONCURRENCY, async (fixture) => {
    const errors: string[] = [];
    let enrichment: FixtureEnrichment = {};

    for (const provider of settings.dataSourcePriorities) {
      try {
        enrichment = await loadEnrichment(provider, fixture);
        break;
      } catch (err) {
        errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const weather = await fetchWeather(fixture.venueLatitude, fixture.venueLongitude);
      if (weather) enrichment = { ...enrichment, weather };
    } catch (err) {
      errors.push(`weather: ${err instanceof Error ? err.message : String(err)}`);
    }

    return {
      fixture,
      enrichment: { ...enrichment, errors: [...(enrichment.errors ?? []), ...errors] },
    };
  });
}

async function loadEnrichment(provider: string, fixture: Fixture): Promise<FixtureEnrichment> {
  if (provider === 'api-football') return fetchApiFootballEnrichment(fixture);
  if (provider === 'football-data') return fetchFootballDataEnrichment(fixture);
  throw new Error(`Unknown provider: ${provider}`);
}
