const REDACTED_PAYLOAD_KEYS = new Set([
  'authorization_code',
  'card_token',
  'token',
  'secret',
  'password',
  'cvv',
  'pin',
  'otp',
  'raw',
]);

export function redactPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== 'object') return payload;
  if (Array.isArray(payload)) return payload.map(redactPayload);

  const clone: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (REDACTED_PAYLOAD_KEYS.has(key.toLowerCase())) {
      clone[key] = '[redacted]';
      continue;
    }
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      clone[key] = redactPayload(value);
    } else {
      clone[key] = value;
    }
  }
  return clone;
}
