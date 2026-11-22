import type { AnalysisSettings, DataSource, Fixture, FixtureEnrichment } from '@/types/analysis';
import { fetchApiFootballEnrichment } from '@/lib/api/football-api';
import { fetchFootballDataEnrichment } from '@/lib/api/football-data';
import { ProviderAuthError, ProviderQuotaExhaustedError } from '@/lib/api/retry';
import { classifyEnrichment } from './quality';
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
    let usedProvider: DataSource | undefined;

    for (const provider of settings.dataSourcePriorities) {
      try {
        enrichment = await loadEnrichment(provider, fixture);
        usedProvider = provider;
        break;
      } catch (err) {
        // Entitlement exhaustion must abort the run loudly; degrading silently
        // would present a partially-enriched analysis as a complete one.
        if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
        errors.push(`${provider}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      const weather = await fetchWeather(fixture.venueLatitude, fixture.venueLongitude);
      if (weather) enrichment = { ...enrichment, weather };
    } catch (err) {
      errors.push(`weather: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Classify what was ACTUALLY obtained. Fallback data is never labelled as
    // complete primary enrichment, and missing inputs are recorded explicitly so
    // the market gate can tighten and admins can see why (Stage 6).
    const classification = usedProvider
      ? classifyEnrichment(usedProvider, enrichment)
      : { quality: 'INSUFFICIENT_DATA' as const, missingFields: [] };

    return {
      fixture,
      enrichment: {
        ...enrichment,
        dataSource: usedProvider,
        quality: classification.quality,
        missingFields: classification.missingFields,
        errors: [...(enrichment.errors ?? []), ...errors],
      },
    };
  });
}

async function loadEnrichment(provider: DataSource, fixture: Fixture): Promise<FixtureEnrichment> {
  if (provider === 'api-football') return fetchApiFootballEnrichment(fixture);
  if (provider === 'football-data') return fetchFootballDataEnrichment(fixture);
  throw new Error(`Unknown provider: ${provider}`);
}
