import { describe, it, expect } from 'vitest';
import { passwordStrength } from '@/lib/password-strength';

describe('passwordStrength', () => {
  it('scores empty string as 0 with no label', () => {
    expect(passwordStrength('')).toEqual({ score: 0, label: '' });
  });

  it('scores a short simple password as weak', () => {
    const result = passwordStrength('abc123');
    expect(result.score).toBeLessThanOrEqual(2);
  });

  it('scores a long, varied password as strong', () => {
    const result = passwordStrength('Correct-Horse-Battery-9!');
    expect(result.score).toBe(4);
    expect(result.label).toBe('Strong');
  });

  it('rewards length independently of character variety', () => {
    const short = passwordStrength('abcdefg1');
    const long = passwordStrength('abcdefghijkl1');
    expect(long.score).toBeGreaterThan(short.score);
  });

  it('rewards mixed case, digits, and symbols', () => {
    const plain = passwordStrength('abcdefgh');
    const mixed = passwordStrength('Abcdefg1!');
    expect(mixed.score).toBeGreaterThan(plain.score);
  });

  it('never exceeds the max score of 4', () => {
    const result = passwordStrength('Extremely-Long-And-Varied-Password-123!@#');
    expect(result.score).toBe(4);
  });
});
