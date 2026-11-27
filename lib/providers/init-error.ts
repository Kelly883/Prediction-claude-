/**
 * Distinguishes a *definitive* provider rejection (the provider replied and
 * reliably established that initialization was rejected and no checkout was
 * created) from an *uncertain* outcome (network failure, timeout, connection
 * reset, rate-limit, server error, or a malformed/incomplete response) where a
 * checkout may already have been created.
 *
 * Payment initialization uses this to decide whether the pending transaction
 * can be safely marked `failed` (definitive) or must be preserved as `pending`
 * for investigation/recovery (uncertain).
 */
export class ProviderInitError extends Error {
  readonly definitive: boolean;

  constructor(message: string, definitive: boolean) {
    super(message);
    this.name = 'ProviderInitError';
    this.definitive = definitive;
  }
}

/**
 * Classify an HTTP status from a provider initialization response.
 *
 * Definitive ONLY for client errors (4xx) that reliably mean the request was
 * rejected and no session was created — i.e. 400/401/403/404/409/422 etc.
 * Everything else is uncertain:
 *   - 408 (request timeout) and 429 (rate limited) are 4xx but transient.
 *   - 5xx are provider-side failures that may or may not have created a session.
 *   - 3xx/other are not a reliable rejection.
 */
export function isDefinitiveRejection(status: number): boolean {
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}