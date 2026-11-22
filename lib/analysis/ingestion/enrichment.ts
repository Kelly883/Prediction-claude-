import type { AnalysisSettings, DataSource, Fixture, FixtureEnrichment, WeatherRecord } from '@/types/analysis';
import { fetchApiFootballEnrichment } from '@/lib/api/football-api';
import { fetchFootballDataEnrichment } from '@/lib/api/football-data';
import { ProviderAuthError, ProviderQuotaExhaustedError } from '@/lib/api/retry';
import { classifyProviderFailure } from '@/lib/api/failure-classification';
import { getProviderConfig } from '@/lib/api/provider-config';
import { incrProviderMetric } from '@/lib/api/provider-metrics';
import { logger } from '@/lib/logger';
import { classifyEnrichment } from './quality';
import { fetchWeather } from './weather';

const MAX_CONCURRENCY = 10;

type EnrichmentOverrides = {
  loadEnrichment?: (provider: string) => Promise<FixtureEnrichment>;
  fetchWeather?: () => Promise<WeatherRecord | undefined>;
};
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
  overrides?: EnrichmentOverrides,
): Promise<Array<{ fixture: Fixture; enrichment: FixtureEnrichment }>> {
  // Fixture-level concurrency is configurable (default 10). It is NOT a
  // substitute for the global rate limiter: every provider request still
  // reserves a slot in the shared distributed limiter, which remains the final
  // authority regardless of this setting.
  const concurrency = Math.max(1, getProviderConfig().enrichmentConcurrency);
  const fetchWeatherOverride = overrides?.fetchWeather;

  return mapWithConcurrency(fixtures, concurrency, async (fixture) => {
    const customLoad = overrides?.loadEnrichment;
    const load = customLoad
      ? (provider: string) => customLoad(provider)
      : (provider: string) => loadEnrichment(provider, fixture);
    const errors: string[] = [];
    let enrichment: FixtureEnrichment = {};
    let usedProvider: DataSource | undefined;
    let degradedFrom: DataSource | undefined;

    for (const provider of settings.dataSourcePriorities) {
      try {
        enrichment = await load(provider);
        usedProvider = provider;
        break;
      } catch (err) {
        // Entitlement exhaustion must abort the run loudly; degrading silently
        // would present a partially-enriched analysis as a complete one.
        if (err instanceof ProviderQuotaExhaustedError || err instanceof ProviderAuthError) throw err;
        const failure = classifyProviderFailure(err);
        errors.push(`${provider}: ${failure.category}: ${failure.message}`);
        // Record that primary enrichment failed and a fallback is being tried.
        // The fallback result is classified as degraded below — never as
        // equivalent to primary-provider data.
        degradedFrom = provider;
        // Provider-specific fallback counter (never counts a cache hit).
        if (provider === 'api-football') void incrProviderMetric('af:fallbackActivated');
        else if (provider === 'football-data') void incrProviderMetric('fd:fallbackActivated');
        logger.warn('provider.fallback.activated', {
          fixtureId: fixture.id,
          leagueId: fixture.leagueCode,
          fromProvider: provider,
          failureCategory: failure.category,
        });
      }
    }

    try {
      const weather = fetchWeatherOverride
        ? await fetchWeatherOverride()
        : await fetchWeather(fixture.venueLatitude, fixture.venueLongitude);
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

    // A fallback was used: record it explicitly so the degraded enrichment is
    // never mistaken for complete primary-provider data.
    if (degradedFrom) {
      errors.push(`enrichment degraded: primary provider ${degradedFrom} failed; used ${usedProvider ?? 'none'}`);
    }

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
