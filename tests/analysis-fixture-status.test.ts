import { describe, expect, it } from 'vitest';

import {
  exclusionReason,
  isPredictableStatus,
  normalizeApiFootballStatus,
  normalizeFootballDataStatus,
} from '@/lib/analysis/ingestion/status';
import { partitionByStatus } from '@/lib/analysis/ingestion/fixtures';
import type { Fixture, FixtureStatus } from '@/types/analysis';

describe('provider status normalisation (Stage 5)', () => {
  it('maps API-Football short codes onto the internal vocabulary', () => {
    expect(normalizeApiFootballStatus('NS').status).toBe('scheduled');
    expect(normalizeApiFootballStatus('TBD').status).toBe('scheduled');
    expect(normalizeApiFootballStatus('1H').status).toBe('in_play');
    expect(normalizeApiFootballStatus('HT').status).toBe('in_play');
    expect(normalizeApiFootballStatus('FT').status).toBe('finished');
    expect(normalizeApiFootballStatus('AET').status).toBe('finished');
    expect(normalizeApiFootballStatus('PST').status).toBe('postponed');
    expect(normalizeApiFootballStatus('CANC').status).toBe('cancelled');
    expect(normalizeApiFootballStatus('ABD').status).toBe('abandoned');
    expect(normalizeApiFootballStatus('SUSP').status).toBe('suspended');
    expect(normalizeApiFootballStatus('AWD').status).toBe('awarded');
  });

  it('handles unknown or malformed API-Football statuses conservatively', () => {
    expect(normalizeApiFootballStatus('ZZ').status).toBe('unknown');
    expect(normalizeApiFootballStatus(undefined).status).toBe('unknown');
    expect(normalizeApiFootballStatus(42).status).toBe('unknown');
    // Falls back to the long description label when the code is unknown.
    const long = normalizeApiFootballStatus('ZZ', 'Match Postponed');
    expect(long.status).toBe('unknown');
    expect(long.label).toBe('ZZ');
  });

  it('maps Football-Data.org status values onto the internal vocabulary', () => {
    expect(normalizeFootballDataStatus('SCHEDULED').status).toBe('scheduled');
    expect(normalizeFootballDataStatus('TIMED').status).toBe('scheduled');
    expect(normalizeFootballDataStatus('IN_PLAY').status).toBe('in_play');
    expect(normalizeFootballDataStatus('PAUSED').status).toBe('in_play');
    expect(normalizeFootballDataStatus('FINISHED').status).toBe('finished');
    expect(normalizeFootballDataStatus('POSTPONED').status).toBe('postponed');
    expect(normalizeFootballDataStatus('SUSPENDED').status).toBe('suspended');
    expect(normalizeFootballDataStatus('CANCELED').status).toBe('cancelled');
    expect(normalizeFootballDataStatus('CANCELLED').status).toBe('cancelled');
    expect(normalizeFootballDataStatus('AWARDED').status).toBe('awarded');
    expect(normalizeFootballDataStatus('WHATEVER').status).toBe('unknown');
    expect(normalizeFootballDataStatus(undefined).status).toBe('unknown');
  });

  it('treats only scheduled fixtures as predictable', () => {
    expect(isPredictableStatus('scheduled')).toBe(true);
    for (const status of ['in_play', 'finished', 'postponed', 'cancelled', 'suspended', 'abandoned', 'awarded', 'unknown'] as FixtureStatus[]) {
      expect(isPredictableStatus(status)).toBe(false);
    }
    expect(isPredictableStatus(undefined)).toBe(false);
  });
});

function fixture(id: string, status: FixtureStatus | undefined): Fixture {
  return {
    id,
    leagueCode: 'PL',
    leagueName: 'Premier League',
    kickoff: new Date('2026-11-22T15:00:00.000Z'),
    homeTeam: 'Home FC',
    awayTeam: 'Away FC',
    status,
    source: 'api-football',
  };
}

describe('fixture-status filtering (Stage 5)', () => {
  it('keeps only upcoming fixtures and excludes every invalid status', () => {
    const fixtures: Fixture[] = [
      fixture('sched', 'scheduled'),
      fixture('play', 'in_play'),
      fixture('done', 'finished'),
      fixture('post', 'postponed'),
      fixture('canc', 'cancelled'),
      fixture('susp', 'suspended'),
      fixture('aband', 'abandoned'),
      fixture('award', 'awarded'),
      fixture('unknown', 'unknown'),
      fixture('missing', undefined),
    ];

    const { predictable, excluded } = partitionByStatus(fixtures);

    expect(predictable.map((entry) => entry.id)).toEqual(['sched']);
    expect(excluded).toHaveLength(9);
    expect(excluded.join(' ')).toContain('postponed');
    expect(excluded.join(' ')).toContain('cancelled');
    expect(excluded.join(' ')).toContain('abandoned');
    expect(excluded.join(' ')).toContain('suspended');
    expect(excluded.join(' ')).toContain('finished');
    expect(excluded.join(' ')).toContain('unknown');
  });

  it('never treats a completed fixture as upcoming', () => {
    const { predictable } = partitionByStatus([fixture('done', 'finished')]);
    expect(predictable).toHaveLength(0);
  });

  it('records an exclusion reason that names the status', () => {
    expect(exclusionReason(fixture('post', 'postponed'))).toContain('postponed');
    expect(exclusionReason({ id: 'x' })).toContain('unknown');
  });
});
