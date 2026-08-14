import { parse } from 'csv-parse/sync';
import { prisma } from './prisma';

const REQUIRED_COLUMNS = ['date', 'time', 'matches', 'prediction', 'booking_code'];
const MAX_ROWS = 2000; // a matchday post is a handful to a few dozen matches — 2000 is already generous headroom

export interface CsvRowError { line: number; message: string }
export interface CsvPreviewResult {
  rows: Array<{ line: number; date: string; time: string; matches: string; prediction: string; bookingCode: string }>;
  errors: CsvRowError[];
  bookingCode: string | null;
}

// Implements PRD Section 7 + design doc 5.1.
export function previewCsv(csvContent: string): CsvPreviewResult {
  const records: Record<string, string>[] = parse(csvContent, { columns: true, skip_empty_lines: true, trim: true });

  const errors: CsvRowError[] = [];
  const rows: CsvPreviewResult['rows'] = [];
  let bookingCode: string | null = null;

  if (records.length === 0) {
    return { rows: [], errors: [{ line: 0, message: 'CSV has no data rows' }], bookingCode: null };
  }
  if (records.length > MAX_ROWS) {
    return { rows: [], errors: [{ line: 0, message: `CSV has ${records.length} rows — max ${MAX_ROWS} per post` }], bookingCode: null };
  }

  const header = Object.keys(records[0]);
  const missingCols = REQUIRED_COLUMNS.filter((c) => !header.includes(c));
  if (missingCols.length > 0) {
    return { rows: [], errors: [{ line: 1, message: `Missing required column(s): ${missingCols.join(', ')}` }], bookingCode: null };
  }

  records.forEach((record, idx) => {
    const line = idx + 2;
    const { date, time, matches, prediction, booking_code } = record;

    if (!date || isNaN(Date.parse(date))) errors.push({ line, message: `Invalid or missing date: "${date}"` });
    if (!time || !/^\d{1,2}:\d{2}$/.test(time)) errors.push({ line, message: `Invalid or missing time (expected HH:MM): "${time}"` });
    if (!matches) errors.push({ line, message: 'Missing matches' });
    if (!prediction) errors.push({ line, message: 'Missing prediction' });
    if (!booking_code) errors.push({ line, message: 'Missing booking_code' });

    if (booking_code) {
      if (bookingCode === null) bookingCode = booking_code;
      else if (bookingCode !== booking_code) {
        errors.push({ line, message: `booking_code "${booking_code}" differs from the file's first booking_code "${bookingCode}" — a post can only have one code` });
      }
    }

    rows.push({ line, date, time, matches, prediction, bookingCode: booking_code });
  });

  return { rows, errors, bookingCode };
}

export function toErrorCsv(errors: CsvRowError[]): string {
  const lines = ['line,message', ...errors.map((e) => `${e.line},"${e.message.replace(/"/g, '""')}"`)];
  return lines.join('\n');
}

/** Called only after previewCsv() returns zero errors and the admin confirms. */
export async function confirmCsvImport(params: {
  title: string;
  categoryIds: string[];
  visibility: 'plan_specific' | 'subscribers' | 'free_window';
  planIds: string[];
  freeUntil?: Date;
  createdById: string;
  rows: CsvPreviewResult['rows'];
  bookingCode: string;
  publishNow: boolean;
}) {
  return prisma.predictionPost.create({
    data: {
      title: params.title,
      scheduledAt: new Date(`${params.rows[0].date}T${params.rows[0].time}`),
      categoryIds: params.categoryIds,
      bookingCode: params.bookingCode,
      visibility: params.visibility,
      planIds: params.planIds,
      freeUntil: params.freeUntil,
      status: params.publishNow ? 'published' : 'scheduled',
      createdById: params.createdById,
      items: {
        create: params.rows.map((r) => ({ match: r.matches, prediction: r.prediction, matchDateTime: new Date(`${r.date}T${r.time}`) })),
      },
    },
    include: { items: true },
  });
}
