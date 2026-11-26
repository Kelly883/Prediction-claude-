import type { WeatherRecord } from '@/types/analysis';
import { cachedProviderFetch } from './cache';
import { toNumber } from '@/lib/analysis/utils/normalization';

const TIMEOUT_MS = Number(process.env.FOOTBALL_API_TIMEOUT_MS ?? 10_000);

export async function fetchWeather(
  latitude?: number,
  longitude?: number,
  kickoff?: Date | string,
): Promise<WeatherRecord | undefined> {
  if (latitude === undefined || longitude === undefined) return undefined;

  const kickoffDate = kickoff === undefined ? undefined : new Date(kickoff);
  if (kickoffDate !== undefined && !Number.isFinite(kickoffDate.getTime())) return undefined;

  const key = `weather:${latitude.toFixed(3)}:${longitude.toFixed(3)}:${
    kickoffDate ? kickoffDate.toISOString().slice(0, 13) : 'current'
  }`;
  try {
    return await cachedProviderFetch(key, async () => {
    const url = new URL('https://api.open-meteo.com/v1/forecast');
    url.searchParams.set('latitude', String(latitude));
    url.searchParams.set('longitude', String(longitude));

    if (kickoffDate) {
      url.searchParams.set('hourly', 'temperature_2m,precipitation,wind_speed_10m,weather_code');
      url.searchParams.set('timezone', 'UTC');
      url.searchParams.set('forecast_days', '16');

      const response = await fetch(url.toString(), {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`Weather request failed: ${response.status}`);
      const payload = await response.json() as any;
      const times: unknown[] = Array.isArray(payload?.hourly?.time) ? payload.hourly.time : [];
      const target = kickoffDate.toISOString().slice(0, 13) + ':00';
      const index = times.findIndex((value) => String(value) === target);
      if (index < 0) return undefined;
      const code = toNumber(payload?.hourly?.weather_code?.[index]);
      return {
        temperature: toNumber(payload?.hourly?.temperature_2m?.[index]),
        precipitation: toNumber(payload?.hourly?.precipitation?.[index]),
        windSpeed: toNumber(payload?.hourly?.wind_speed_10m?.[index]),
        condition: weatherCondition(code),
      };
    }

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
  } catch {
    return undefined;
  }
}

function weatherCondition(code: number | undefined): string | undefined {
  if (code === undefined) return undefined;
  if (code >= 95) return 'thunderstorm';
  if (code >= 71) return 'snow';
  if (code >= 51) return 'rain';
  if (code >= 45) return 'fog';
  return 'clear';
}
