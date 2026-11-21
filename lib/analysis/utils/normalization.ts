import type { H2HRecord, WeatherRecord } from '@/types/analysis';
import { clamp, normalize } from './confidence';

export function goalRateScore(value: number | undefined, reference: number): number {
  if (value === undefined || !Number.isFinite(value)) return 50;
  return normalize(50 + (value - reference) * 24);
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

export function parseForm(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const forms = value.map((item) => String(item).trim().toUpperCase()[0]).filter((item) => ['W', 'D', 'L'].includes(item));
    return forms.length > 0 ? forms : undefined;
  }
  if (typeof value === 'string') {
    const forms = value.toUpperCase().replace(/[^WDL]/g, '').split('').filter(Boolean);
    return forms.length > 0 ? forms : undefined;
  }
  return undefined;
}

export function formScore(form: string[] | undefined): number {
  if (!form || form.length === 0) return 50;
  const total = form.reduce((sum, result) => {
    if (result === 'W') return sum + 100;
    if (result === 'D') return sum + 50;
    return sum;
  }, 0);
  return normalize(total / form.length);
}

export function h2hHomeScore(h2h: H2HRecord | undefined): number {
  const matches = toNumber(h2h?.matches);
  if (!matches || matches <= 0) return 50;
  const homeWins = toNumber(h2h?.homeWins) ?? 0;
  const draws = toNumber(h2h?.draws) ?? 0;
  return normalize(((homeWins + draws * 0.5) / matches) * 100);
}

export function h2hDrawScore(h2h: H2HRecord | undefined): number {
  const matches = toNumber(h2h?.matches);
  if (!matches || matches <= 0) return 50;
  return normalize(((toNumber(h2h?.draws) ?? 0) / matches) * 100);
}

export function h2hRateScore(rate: number | undefined): number {
  const value = toNumber(rate);
  if (value === undefined) return 50;
  return normalize(value <= 1 ? value * 100 : value);
}

export function weatherSupportsGoals(weather: WeatherRecord | undefined): number {
  if (!weather) return 50;
  const precipitation = toNumber(weather.precipitation) ?? 0;
  const wind = toNumber(weather.windSpeed) ?? 0;
  const temperature = toNumber(weather.temperature) ?? 18;
  const conditionPenalty = /storm|snow|heavy/i.test(weather.condition ?? '') ? 20 : 0;
  return normalize(60 - precipitation * 8 - wind * 0.8 - Math.abs(temperature - 18) * 0.4 - conditionPenalty);
}

export function playerPositionScore(position: string | undefined): number {
  const value = (position ?? '').toLowerCase();
  if (value.includes('forward') || value.includes('striker') || value === 'att') return 90;
  if (value.includes('mid')) return 70;
  if (value.includes('def')) return 35;
  return 55;
}

export function expectedScoreline(homeExpected: number, awayExpected: number): string {
  const home = Math.max(0, Math.min(homeExpected, 6));
  const away = Math.max(0, Math.min(awayExpected, 6));
  return `${Math.round(home)}-${Math.round(away)}`;
}

export function motivationDiffScore(home: number | undefined, away: number | undefined): number {
  if (home === undefined || away === undefined) return 50;
  return normalize(clamp(50 + (home - away) / 2));
}

export function scheduleScore(homeRestDays: number | undefined, awayRestDays: number | undefined): number {
  if (homeRestDays === undefined || awayRestDays === undefined) return 50;
  return normalize(50 + (homeRestDays - awayRestDays) * 5);
}
