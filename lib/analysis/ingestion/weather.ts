import type { WeatherRecord } from '@/types/analysis';
import { cachedProviderFetch } from './cache';
import { toNumber } from '@/lib/analysis/utils/normalization';

const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

export async function fetchWeather(latitude?: number, longitude?: number): Promise<WeatherRecord | undefined> {
  if (latitude === undefined || longitude === undefined) return undefined;
  const key = `weather:${latitude.toFixed(3)}:${longitude.toFixed(3)}`;
  return cachedProviderFetch(key, async () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));
    url.searchParams.set('current', 'temperature_2m,precipitation,wind_speed_10m,weather_code');

    const response = await fetch(url.toString(), {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
    const payload = await response.json() as any;
    const current = payload?.current ?? {};
    const code = toNumber(current.weather_code);
    return {
      temperature: toNumber(current.temperature_2m),
      precipitation: toNumber(current.precipitation),
      windSpeed: toNumber(current.wind_speed_10m),
      condition: weatherCondition(code),
    };
  });
}

function weatherCondition(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (code >= 95) return 'thunderstorm';
  if (code >= 71) return 'snow';
  if (code >= 51) return 'rain';
  if (code >= 45) return 'fog';
  return 'clear';
}
