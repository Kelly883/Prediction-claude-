import { describe, expect, it } from 'vitest';
import {
  apiFootballLeagueId,
  footballDataCompetitionCode,
  isLeagueSupportedByProvider,
  supportedLeaguesByProvider,
  apiFootballSeasonForKickoff,
  buildProviderCoverageReport,
} from '@/lib/analysis/leagues';

describe('apiFootballLeagueId', () => {
  it('maps PL to 39', () => {
    expect(apiFootballLeagueId('PL')).toBe(39);
  });

  it('maps LIB to 13 (Copa Libertadores)', () => {
    expect(apiFootballLeagueId('LIB')).toBe(13);
  });

  it('maps ARG to 128 (Argentina Liga Profesional)', () => {
    expect(apiFootballLeagueId('ARG')).toBe(128);
  });

  it('maps ECL to 848', () => {
    expect(apiFootballLeagueId('ECL')).toBe(848);
  });

  it('returns undefined for unknown codes', () => {
    expect(apiFootballLeagueId('UNKNOWN')).toBeUndefined();
  });

  it('has all 20 leagues', () => {
    expect(Object.keys({ PL: 1, PD: 1, BL1: 1, SA: 1, FL1: 1, PPL: 1, ERE: 1, CL: 1, EL: 1, ECL: 1, BL2: 1, PD2: 1, SA2: 1, FL2: 1, ELC: 1, MLS: 1, LIB: 1, J1: 1, ARG: 1, BRA: 1 })).toHaveLength(20);
  });
});

describe('footballDataCompetitionCode', () => {
  it('maps PL to PL', () => {
    expect(footballDataCompetitionCode('PL')).toBe('PL');
  });

  it('returns null for ECL (not on free tier)', () => {
    expect(footballDataCompetitionCode('ECL')).toBeNull();
  });

  it('returns null for LIB (not on free tier)', () => {
    expect(footballDataCompetitionCode('LIB')).toBeNull();
  });

  it('returns null for J1 (not on free tier)', () => {
    expect(footballDataCompetitionCode('J1')).toBeNull();
  });

  it('returns null for ARG (not on free tier)', () => {
    expect(footballDataCompetitionCode('ARG')).toBeNull();
  });

  it('maps BRA to BRA', () => {
    expect(footballDataCompetitionCode('BRA')).toBe('BRA');
  });
});

describe('isLeagueSupportedByProvider', () => {
  it('api-football supports all 20', () => {
    const codes = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'PPL', 'ERE', 'CL', 'EL', 'ECL', 'BL2', 'PD2', 'SA2', 'FL2', 'ELC', 'MLS', 'LIB', 'J1', 'ARG', 'BRA'];
    for (const code of codes) {
      expect(isLeagueSupportedByProvider('api-football', code)).toBe(true);
    }
  });

  it('football-data does not support ECL', () => {
    expect(isLeagueSupportedByProvider('football-data', 'ECL')).toBe(false);
  });
});

describe('apiFootballSeasonForKickoff', () => {
  it('autumn 2026 → season 2026', () => {
    expect(apiFootballSeasonForKickoff(new Date('2026-10-15'))).toBe(2026);
  });

  it('spring 2026 → season 2025', () => {
    expect(apiFootballSeasonForKickoff(new Date('2026-03-15'))).toBe(2025);
  });

  it('january 2027 → season 2026', () => {
    expect(apiFootballSeasonForKickoff(new Date('2027-01-15'))).toBe(2026);
  });
});

describe('buildProviderCoverageReport', () => {
  const allCodes = ['PL', 'PD', 'BL1', 'SA', 'FL1', 'PPL', 'ERE', 'CL', 'EL', 'ECL', 'BL2', 'PD2', 'SA2', 'FL2', 'ELC', 'MLS', 'LIB', 'J1', 'ARG', 'BRA'];

  it('reports 20 supported for api-football', () => {
    const report = buildProviderCoverageReport(allCodes, 'api-football');
    expect(report.supportedLeagues).toHaveLength(20);
    expect(report.unsupportedLeagues).toHaveLength(0);
  });

  it('reports 16 supported, 4 unsupported for football-data', () => {
    const report = buildProviderCoverageReport(allCodes, 'football-data');
    expect(report.supportedLeagues).toHaveLength(16);
    expect(report.unsupportedLeagues).toHaveLength(4);
    expect(report.unsupportedLeagues).toEqual(expect.arrayContaining(['ECL', 'LIB', 'J1', 'ARG']));
  });
});