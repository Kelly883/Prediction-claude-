/**
 * Provider fixture-status normalisation and prediction eligibility.
 *
 * A fixture returned inside the 48-hour window is NOT automatically valid: it
 * may be postponed, cancelled, abandoned or suspended, or it may already be in
 * play or finished. The engine must only predict fixtures that have not started
 * and are expected to be played, so providers' status vocabularies are mapped
 * onto a single internal `FixtureStatus` and gated once, centrally.
 *
 * Unknown or malformed statuses are handled conservatively: they map to
 * `unknown`, which is NOT eligible for prediction.
 */
import type { FixtureStatus } from '@/types/analysis';

/** API-Football v3 fixture status short codes → normalised status. */
const API_FOOTBALL_STATUS: Record<string, FixtureStatus> = {
  TBD: 'scheduled',
  NS: 'scheduled',
  '1H': 'in_play',
  HT: 'in_play',
  '2H': 'in_play',
  ET: 'in_play',
  BT: 'in_play',
  P: 'in_play',
  LIVE: 'in_play',
  SUSP: 'suspended',
  INT: 'suspended',
  FT: 'finished',
  AET: 'finished',
  PEN: 'finished',
  PST: 'postponed',
  CANC: 'cancelled',
  ABD: 'abandoned',
  AWD: 'awarded',
  WO: 'awarded',
};

/** Football-Data.org match status values → normalised status. */
const FOOTBALL_DATA_STATUS: Record<string, FixtureStatus> = {
  SCHEDULED: 'scheduled',
  TIMED: 'scheduled',
  IN_PLAY: 'in_play',
  PAUSED: 'in_play',
  FINISHED: 'finished',
  SUSPENDED: 'suspended',
  POSTPONED: 'postponed',
  CANCELED: 'cancelled',
  CANCELLED: 'cancelled',
  AWARDED: 'awarded',
};

export interface NormalizedStatus {
  status: FixtureStatus;
  /** Raw provider label retained for diagnostics. */
  label?: string;
}

/** Map an API-Football status (short code preferred, long text fallback). */
export function normalizeApiFootballStatus(short?: unknown, long?: unknown): NormalizedStatus {
  const code = typeof short === 'string' ? short.trim().toUpperCase() : '';
  const label = code || (typeof long === 'string' ? long.trim() : undefined);
  if (code && API_FOOTBALL_STATUS[code]) return { status: API_FOOTBALL_STATUS[code], label };
  return { status: 'unknown', label };
}

/** Map a Football-Data.org status value. */
export function normalizeFootballDataStatus(value?: unknown): NormalizedStatus {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (code && FOOTBALL_DATA_STATUS[code]) return { status: FOOTBALL_DATA_STATUS[code], label: code };
  return { status: 'unknown', label: code || undefined };
}

/** Only not-yet-started fixtures are eligible for prediction. */
export function isPredictableStatus(status: FixtureStatus | undefined): boolean {
  return status === 'scheduled';
}

/** Human-readable reason a fixture was excluded, for monitoring. */
export function exclusionReason(fixture: { id: string; status?: FixtureStatus }): string {
  return `fixture ${fixture.id} excluded: status=${fixture.status ?? 'unknown'} is not predictable`;
}
