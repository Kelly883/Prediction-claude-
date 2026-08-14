import { describe, it, expect } from 'vitest';
import { previewCsv } from '@/lib/csv-import';

describe('previewCsv', () => {
  it('accepts a valid CSV with a consistent booking code', () => {
    const csv = `date,time,matches,prediction,booking_code
2026-08-10,15:00,Arsenal vs Chelsea,Over 2.5,AB12
2026-08-10,17:30,City vs Spurs,1X,AB12`;

    const result = previewCsv(csv);
    expect(result.errors).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    expect(result.bookingCode).toBe('AB12');
  });

  it('flags missing required columns', () => {
    const csv = `date,time,matches\n2026-08-10,15:00,Arsenal vs Chelsea`;
    const result = previewCsv(csv);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/Missing required column/);
  });

  it('flags an invalid date', () => {
    const csv = `date,time,matches,prediction,booking_code\nnot-a-date,15:00,Arsenal vs Chelsea,Over 2.5,AB12`;
    const result = previewCsv(csv);
    expect(result.errors.some((e) => e.message.includes('Invalid or missing date'))).toBe(true);
  });

  it('flags a booking code that differs mid-file (one code per post)', () => {
    const csv = `date,time,matches,prediction,booking_code
2026-08-10,15:00,Arsenal vs Chelsea,Over 2.5,AB12
2026-08-10,17:30,City vs Spurs,1X,ZZ99`;
    const result = previewCsv(csv);
    expect(result.errors.some((e) => e.message.includes('differs from'))).toBe(true);
  });

  it('flags missing time in the expected HH:MM format', () => {
    const csv = `date,time,matches,prediction,booking_code\n2026-08-10,3pm,Arsenal vs Chelsea,Over 2.5,AB12`;
    const result = previewCsv(csv);
    expect(result.errors.some((e) => e.message.includes('Invalid or missing time'))).toBe(true);
  });
});
