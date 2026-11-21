/**
 * Minimal structured logger.
 *
 * Emits single-line JSON records so operational logs (analysis runs, provider
 * failures, cache degradation, lock contention) can be filtered and alerted on
 * in any log aggregator. Never pass secrets or raw provider bodies here — the
 * analysis pipeline already redacts/limits those at their source.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogFields {
  [key: string]: unknown;
}

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function threshold(): number {
  const configured = (process.env.LOG_LEVEL ?? '').toLowerCase() as LogLevel;
  if (configured in LEVEL_RANK) return LEVEL_RANK[configured];
  return process.env.NODE_ENV === 'production' ? LEVEL_RANK.info : LEVEL_RANK.debug;
}

function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
  if (LEVEL_RANK[level] < threshold()) return;
  const record = JSON.stringify({ ts: new Date().toISOString(), level, event, ...fields });
  if (level === 'error') console.error(record);
  else if (level === 'warn') console.warn(record);
  else console.log(record);
}

export const logger = {
  debug: (event: string, fields?: LogFields) => emit('debug', event, fields),
  info: (event: string, fields?: LogFields) => emit('info', event, fields),
  warn: (event: string, fields?: LogFields) => emit('warn', event, fields),
  error: (event: string, fields?: LogFields) => emit('error', event, fields),
};
