import { redis } from './redis';

/**
 * Refresh-token rotation tracking, backed by Redis so that "this JTI was
 * already exchanged" survives across serverless instances (an in-process
 * Set does NOT — each Lambda invocation has its own memory, so a replayed
 * refresh token would pass reuse detection on any other instance).
 *
 * Uses claim-on-consume semantics (SET NX): the first request presenting a
 * given JTI wins; concurrent replays get `false` and are rejected.
 *
 * Fail-open policy matches lib/fx.ts: if Redis errors, we log and allow the
 * request rather than logging every user out during a Redis outage.
 * Reuse detection degrades to best-effort, which is strictly no worse than
 * the previous per-instance in-memory behavior.
 */

const KEY_PREFIX = 'rt-jti:';
const DEFAULT_REFRESH_TTL_SECONDS = 7 * 24 * 60 * 60; // matches JWT_REFRESH_TTL default ('7d')

function ttlSeconds(): number {
  const raw = process.env.JWT_REFRESH_TTL;
  if (!raw) return DEFAULT_REFRESH_TTL_SECONDS;
  const m = raw.trim().match(/^(\d+)\s*(ms|s|m|h|d)?$/i);
  if (!m) return DEFAULT_REFRESH_TTL_SECONDS;
  const n = parseInt(m[1], 10);
  switch ((m[2] ?? 's').toLowerCase()) {
    case 'ms':
      return Math.max(1, Math.ceil(n / 1000));
    case 'm':
      return n * 60;
    case 'h':
      return n * 3600;
    case 'd':
      return n * 86400;
    default:
      return n;
  }
}

/**
 * Atomically marks a refresh-token JTI as consumed. Returns false if the
 * JTI was ALREADY consumed (i.e. this is a replay) — callers must reject.
 */
export async function consumeRefreshJti(jti: string): Promise<boolean> {
  try {
    const claimed = await redis.set(`${KEY_PREFIX}${jti}`, '1', { nx: true, ex: ttlSeconds() });
    // Upstash REST returns 'OK' on success, null when NX fails.
    return claimed !== null && claimed !== undefined;
  } catch (err) {
    console.error('Refresh JTI store unavailable, allowing refresh (fail-open):', err);
    return true;
  }
}
