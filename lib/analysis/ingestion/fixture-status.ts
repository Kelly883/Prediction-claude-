import type { Fixture, FixtureStatus } from '@/types/analysis';

export interface FixtureStatusInfo {
  status: FixtureStatus;
  reason?: string;
}

const API_FOOTBALL_STATUS: Record<string, FixtureStatusInfo> = {
  NS: { status: 'scheduled' },
  TBD: { status: 'unknown', reason: 'Kickoff time not defined' },
  '1H': { status: 'live', reason: 'Match in progress' },
  HT: { status: 'live', reason: 'Match in progress' },
  '2H': { status: 'live', reason: 'Match in progress' },
  ET: { status: 'live', reason: 'Match in progress' },
  PEN: { status: 'live', reason: 'Match in progress' },
  BREAK: { status: 'live', reason: 'Match in progress' },
  FT: { status: 'finished', reason: 'Match finished' },
  AET: { status: 'finished', reason: 'Match finished' },
  FT_PEN: { status: 'finished', reason: 'Match finished' },
  PST: { status: 'postponed', reason: 'Match postponed' },
  CANC: { status: 'cancelled', reason: 'Match cancelled' },
  ABD: { status: 'abandoned', reason: 'Match abandoned' },
  SUSP: { status: 'suspended', reason: 'Match suspended' },
  INT: { status: 'live', reason: 'Match interrupted' },
};

const FOOTBALL_DATA_STATUS: Record<string, FixtureStatusInfo> = {
  SCHEDULED: { status: 'scheduled' },
  TIMED: { status: 'scheduled' },
  IN_PLAY: { status: 'live', reason: 'Match in progress' },
  PAUSED: { status: 'live', reason: 'Match in progress' },
  FINISHED: { status: 'finished', reason: 'Match finished' },
  AWARDED: { status: 'finished', reason: 'Match awarded' },
  POSTPONED: { status: 'postponed', reason: 'Match postponed' },
  CANCELLED: { status: 'cancelled', reason: 'Match cancelled' },
  SUSPENDED: { status: 'suspended', reason: 'Match suspended' },
};

export function apiFootballStatusInfo(value: unknown): FixtureStatusInfo {
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return API_FOOTBALL_STATUS[code] ?? { status: 'unknown', reason: `Unrecognized provider status: ${code || 'missing'}` };
}

export function footballDataStatusInfo(value: unknown): FixtureStatusInfo {
  const code = typeof value === 'string' ? value.toUpperCase() : '';
  return FOOTBALL_DATA_STATUS[code] ?? { status: 'unknown', reason: `Unrecognized provider status: ${code || 'missing'}` };
}

export function isPlayableFixture(fixture: Fixture): boolean {
  return fixture.status === 'scheduled';
}
