import { describe, expect, it } from 'vitest';
import {
  poissonPmf,
  scorelineDistribution,
  mostLikelyScoreline,
  threeWayFromDirection,
  doubleChanceFromThreeWay,
  settleAsianHandicap,
  settleQuarterHandicap,
} from '@/lib/analysis/math';

describe('poissonPmf', () => {
  it('returns 1 for P(X=0) when lambda=0', () => {
    expect(poissonPmf(0, 0)).toBe(1);
  });

  it('returns a probability in [0,1]', () => {
    const p = poissonPmf(1.5, 2);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1);
  });

  it('sums to ~1 over a reasonable range', () => {
    let sum = 0;
    for (let k = 0; k <= 15; k += 1) sum += poissonPmf(2, k);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe('scorelineDistribution', () => {
  it('produces a normalized distribution summing to 1', () => {
    const dist = scorelineDistribution(1.5, 1.1);
    const total = dist.reduce((s, e) => s + e.probability, 0);
    expect(total).toBeCloseTo(1, 9);
  });

  it('mostLikelyScoreline returns the highest-probability entry', () => {
    const dist = scorelineDistribution(1.5, 1.1);
    const best = mostLikelyScoreline(dist);
    const max = Math.max(...dist.map((e) => e.probability));
    expect(best.probability).toBe(max);
  });

  it('handles zero expected goals safely', () => {
    const dist = scorelineDistribution(0, 0);
    const best = mostLikelyScoreline(dist);
    expect(best.home).toBe(0);
    expect(best.away).toBe(0);
  });
});

describe('threeWayFromDirection', () => {
  it('produces probabilities summing to 1', () => {
    const p = threeWayFromDirection(50, 1);
    expect(p.home + p.draw + p.away).toBeCloseTo(1, 9);
  });

  it('even direction gives equal home/away shares', () => {
    const p = threeWayFromDirection(50, 1);
    expect(p.home).toBeCloseTo(p.away, 9);
  });

  it('home-heavy direction gives home the largest share', () => {
    const p = threeWayFromDirection(80, 1);
    expect(p.home).toBeGreaterThan(p.draw);
    expect(p.home).toBeGreaterThan(p.away);
  });

  it('away-heavy direction gives away the largest share', () => {
    const p = threeWayFromDirection(20, 1);
    expect(p.away).toBeGreaterThan(p.draw);
    expect(p.away).toBeGreaterThan(p.home);
  });
});

describe('doubleChanceFromThreeWay', () => {
  const p = threeWayFromDirection(60, 1);
  const dc = doubleChanceFromThreeWay(p);

  it('1X = home + draw', () => {
    expect(dc.homeDraw).toBeCloseTo(p.home + p.draw, 9);
  });

  it('X2 = draw + away', () => {
    expect(dc.drawAway).toBeCloseTo(p.draw + p.away, 9);
  });

  it('12 = home + away', () => {
    expect(dc.homeAway).toBeCloseTo(p.home + p.away, 9);
  });

  it('each double-chance probability is in [0,1]', () => {
    expect(dc.homeDraw).toBeGreaterThanOrEqual(0);
    expect(dc.homeDraw).toBeLessThanOrEqual(1);
    expect(dc.drawAway).toBeGreaterThanOrEqual(0);
    expect(dc.drawAway).toBeLessThanOrEqual(1);
    expect(dc.homeAway).toBeGreaterThanOrEqual(0);
    expect(dc.homeAway).toBeLessThanOrEqual(1);
  });

  it('the three double-chance probabilities sum to 2 (each outcome counted twice)', () => {
    expect(dc.homeDraw + dc.drawAway + dc.homeAway).toBeCloseTo(2, 9);
  });
});

describe('settleAsianHandicap', () => {
  it('-0.5 with gd=1 is a win', () => {
    expect(settleAsianHandicap(1, -0.5).outcome).toBe('win');
  });

  it('-0.5 with gd=0 is a loss', () => {
    expect(settleAsianHandicap(0, -0.5).outcome).toBe('loss');
  });

  it('0 with gd=0 is a push', () => {
    expect(settleAsianHandicap(0, 0).outcome).toBe('push');
  });

  it('+1 with gd=0 is a win', () => {
    expect(settleAsianHandicap(0, 1).outcome).toBe('win');
  });
});

describe('settleQuarterHandicap', () => {
  it('-0.75 with gd=1 is a win', () => {
    expect(settleQuarterHandicap(1, -0.75).outcome).toBe('win');
  });

  it('-0.25 with gd=0 is a half-loss (one half loses, other pushes)', () => {
    const r = settleQuarterHandicap(0, -0.25);
    expect(r.outcome).toBe('loss');
    expect(r.half).toBe('loss');
  });

  it('-0.75 with gd=0 is a full loss (both halves lose)', () => {
    const r = settleQuarterHandicap(0, -0.75);
    expect(r.outcome).toBe('loss');
    expect(r.half).toBeUndefined();
  });

  it('-0.75 with gd=1 is a half-win (one half wins, other pushes)', () => {
    const r = settleQuarterHandicap(1, -0.75);
    expect(r.outcome).toBe('win');
    expect(r.half).toBe('win');
  });
});