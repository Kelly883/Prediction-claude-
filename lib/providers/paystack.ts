import { ProviderInitError, isDefinitiveRejection } from './init-error';

const BASE_URL = 'https://api.paystack.co';

function headers() {
  return {
    Authorization: `Bearer ${process.env.PAYSTACK_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

interface InitializeParams {
  email: string;
  amountMinorUnits: number; // kobo for NGN, cents for USD — Paystack always wants the smallest currency unit
  currency: string;
  reference: string;
  callbackUrl: string;
}

export async function paystackInitialize(params: InitializeParams): Promise<{ authorizationUrl: string }> {
  // A network/timeout/connection-reset failure throws here (fetch rejects) and
  // propagates as an *uncertain* outcome. A completed HTTP response is
  // classified by status: only 4xx (except 408/429) is a definitive rejection;
  // 408/429/5xx and malformed/incomplete 2xx bodies are uncertain.
  const res = await fetch(`${BASE_URL}/transaction/initialize`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinorUnits,
      currency: params.currency,
      reference: params.reference,
      callback_url: params.callbackUrl,
    }),
  });

  const data = await res.json().catch(() => null);

  if (res.ok) {
    if (!data?.data?.authorization_url) {
      // 2xx but no usable session: a checkout may have been created — uncertain.
      throw new ProviderInitError('Paystack initialize: incomplete success response (no authorization_url); outcome uncertain', false);
    }
    return { authorizationUrl: data.data.authorization_url };
  }

  throw new ProviderInitError(
    `Paystack initialize failed: ${data?.message ?? res.statusText} (HTTP ${res.status})`,
    isDefinitiveRejection(res.status),
  );
}

interface ChargeAuthorizationParams {
  email: string;
  amountMinorUnits: number;
  currency: string;
  authorizationCode: string;
  reference: string;
}

interface ChargeResult {
  success: boolean;
  raw: unknown;
}

/** Used by the renewal cron to charge a card on file, with no checkout UI involved. */
export async function paystackChargeAuthorization(params: ChargeAuthorizationParams): Promise<ChargeResult> {
  const res = await fetch(`${BASE_URL}/transaction/charge_authorization`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      email: params.email,
      amount: params.amountMinorUnits,
      currency: params.currency,
      authorization_code: params.authorizationCode,
      reference: params.reference,
    }),
  });

  const data = await res.json();
  const success = res.ok && data.status === true && data.data?.status === 'success';
  return { success, raw: data };
}

export interface VerifyTransactionParams {
  reference?: string;
}

export interface VerifiedPaystackTransaction {
  verified: boolean;
  /**
   * True only when the provider returned a reliable, COMPLETE transaction
   * record (HTTP 2xx + `status: true` + `data`) whose `reference` matches the
   * requested reference and which carries amount/currency/status. When false the
   * outcome is INCONCLUSIVE (5xx, network/timeout, malformed/partial body, or a
   * record for a different reference) and callers must NOT treat it as a
   * definitive payment failure or success.
   */
  conclusive: boolean;
  reference: string;
  amount: number;
  currency: string;
  status: string;
  customerEmail?: string;
  reusableAuthorization?: string | null;
  raw: unknown;
}

/**
 * Verifies a transaction directly with Paystack's verification API.
 * Never blindly trusts webhook payloads without independent verification.
 */
export async function paystackVerifyTransaction(
  params: VerifyTransactionParams,
): Promise<VerifiedPaystackTransaction> {
  if (!params.reference) {
    return {
      verified: false,
      conclusive: false,
      reference: '',
      amount: 0,
      currency: '',
      status: 'failed',
      raw: {},
    };
  }

  const res = await fetch(`${BASE_URL}/transaction/verify/${encodeURIComponent(params.reference)}`, {
    method: 'GET',
    headers: headers(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== true || !data.data) {
    // Non-2xx (incl. 5xx), rate-limit, or an incomplete/malformed body: the
    // outcome is INCONCLUSIVE. Never report this as a definitive failure.
    return {
      verified: false,
      conclusive: false,
      reference: params.reference,
      amount: 0,
      currency: '',
      status: data.data?.status ?? 'failed',
      raw: data,
    };
  }

  const txData = data.data;
  // A record is only CONCLUSIVE when it is complete AND actually corresponds to
  // the reference we asked about. A partial 2xx body (missing reference/amount/
  // currency/status) or a record for a different reference must NOT be treated
  // as a reliable success/failure — it is inconclusive.
  const referenceOk =
    typeof txData.reference === 'string' &&
    txData.reference.length > 0 &&
    txData.reference === params.reference;
  const amountOk = Number.isFinite(Number(txData.amount));
  const currencyOk = typeof txData.currency === 'string' && txData.currency.length > 0;
  const statusOk = typeof txData.status === 'string' && txData.status.length > 0;
  const conclusive = referenceOk && amountOk && currencyOk && statusOk;
  return {
    verified: true,
    conclusive,
    reference: typeof txData.reference === 'string' ? txData.reference : '',
    amount: amountOk ? Number(txData.amount) / 100 : 0,
    currency: currencyOk ? txData.currency : '',
    status: statusOk ? txData.status : 'unknown',
    customerEmail: txData.customer?.email,
    reusableAuthorization: extractReusableAuthorization(txData),
    raw: data,
  };
}

/**
 * Paystack includes a reusable `authorization` object on successful charges
 * when the customer's card supports it. We store this on the Subscription
 * so the renewal cron can charge it later without any user interaction.
 */
export function extractReusableAuthorization(webhookBody: any): string | null {
  const auth = webhookBody?.authorization ?? webhookBody?.data?.authorization;
  if (auth?.authorization_code && auth?.reusable) return auth.authorization_code as string;
  return null;
}
