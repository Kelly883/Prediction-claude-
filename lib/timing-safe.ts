import crypto from 'crypto';

/**
 * Plain `===` on secrets (signatures, cron tokens, etc.) leaks timing
 * information an attacker can use to guess the value byte-by-byte across
 * enough requests. crypto.timingSafeEqual takes constant time regardless of
 * where two buffers first differ — but it throws if the buffers aren't the
 * same length, so that's checked first (a length mismatch is itself safe to
 * reveal quickly; it's not secret-dependent).
 */
export function timingSafeStringEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
