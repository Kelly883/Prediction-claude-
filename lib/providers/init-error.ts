/**
 * Distinguishes a *definitive* provider rejection (the provider replied and
 * refused the initialization request) from an *uncertain* outcome (network
 * failure, timeout, or a lost response) where the checkout may or may not have
 * been created.
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