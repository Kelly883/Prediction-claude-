import { ProviderInitError, isDefinitiveRejection } from './init-error';

const BASE_URL = 'https://api.flutterwave.com/v3';

function headers() {
  return {
    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Explicit request timeout (ms). A timeout aborts the fetch → the promise
// rejects (AbortError) → callers treat it as INCONCLUSIVE/unknown (never a
// definitive failure, never an attempt increment). Invalid env falls back safe.
const DEFAULT_REQUEST_TIMEOUT_MS = 20_000;
function requestTimeoutMs(): number {
  const raw = Number(process.env.PAYMENT_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_REQUEST_TIMEOUT_MS;
}
function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(requestTimeoutMs()) });
}

interface InitializeParams {
  txRef: string;
  amount: number; // major units — Flutterwave, unlike Paystack, wants e.g. 5000.00 not 500000
  currency: string;
  redirectUrl: string;
  customerEmail: string;
}

export async function flutterwaveInitialize(params: InitializeParams): Promise<{ paymentLink: string }> {
  // Network/timeout/connection-reset failures throw (fetch rejects) and are
  // *uncertain*. A completed HTTP response is classified by status: only 4xx
  // (except 408/429) is definitive; 408/429/5xx and malformed/incomplete 2xx
  // bodies are uncertain (a session may already exist).
  const res = await fetchWithTimeout(`${BASE_URL}/payments`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      tx_ref: params.txRef,
      amount: params.amount,
      currency: params.currency,
      redirect_url: params.redirectUrl,
      customer: { email: params.customerEmail },
    }),
  });

  const data = await res.json().catch(() => null);

  if (res.ok) {
    if (data?.status !== 'success' || !data?.data?.link) {
      // 2xx but no usable session: a checkout may have been created — uncertain.
      throw new ProviderInitError('Flutterwave initialize: incomplete success response (no payment link); outcome uncertain', false);
    }
    return { paymentLink: data.data.link };
  }

  throw new ProviderInitError(
    `Flutterwave initialize failed: ${data?.message ?? res.statusText} (HTTP ${res.status})`,
    isDefinitiveRejection(res.status),
  );
}

interface ChargeTokenParams {
  token: string;
  amount: number;
  currency: string;
  email: string;
  txRef: string;
}

interface ChargeResult {
  success: boolean;
  raw: unknown;
}

/** Used by the renewal cron to charge a tokenized card on file. */
export async function flutterwaveChargeToken(params: ChargeTokenParams): Promise<ChargeResult> {
  const res = await fetchWithTimeout(`${BASE_URL}/tokenized-charges`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({
      token: params.token,
      currency: params.currency,
      amount: params.amount,
      email: params.email,
      tx_ref: params.txRef,
    }),
  });

  const data = await res.json();
  const success = res.ok && data.status === 'success' && data.data?.status === 'successful';
  return { success, raw: data };
}

export interface VerifyTransactionParams {
  id?: number | string;
  txRef?: string;
}

export interface VerifiedFlutterwaveTransaction {
  verified: boolean;
  /**
   * True only when the provider returned a reliable, COMPLETE transaction
   * record (HTTP 2xx + `status: 'success'` + `data`) whose `tx_ref` matches the
   * requested txRef and which carries amount/currency/status. When false the
   * outcome is INCONCLUSIVE (5xx, network/timeout, malformed/partial body, or a
   * record for a different reference) and callers must NOT treat it as a
   * definitive payment failure or success.
   */
  conclusive: boolean;
  txRef: string;
  amount: number;
  currency: string;
  status: string;
  customerEmail?: string;
  reusableToken?: string | null;
  raw: unknown;
}

/**
 * Verifies a transaction directly with Flutterwave's verification API.
 * Never blindly trusts webhook payloads without independent verification.
 */
export async function flutterwaveVerifyTransaction(
  params: VerifyTransactionParams,
): Promise<VerifiedFlutterwaveTransaction> {
  const url = params.id
    ? `${BASE_URL}/transactions/${params.id}/verify`
    : `${BASE_URL}/transactions/verify_by_reference?tx_ref=${encodeURIComponent(params.txRef!)}`;

  const res = await fetchWithTimeout(url, {
    method: 'GET',
    headers: headers(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 'success' || !data.data) {
    // Non-2xx (incl. 5xx), rate-limit, or an incomplete/malformed body: the
    // outcome is INCONCLUSIVE. Never report this as a definitive failure.
    return {
      verified: false,
      conclusive: false,
      txRef: params.txRef ?? '',
      amount: 0,
      currency: '',
      status: 'failed',
      raw: data,
    };
  }

  const txData = data.data;
  // A record is only CONCLUSIVE when it is complete AND actually corresponds to
  // the tx_ref we asked about. A partial 2xx body (missing tx_ref/amount/
  // currency/status) or a record for a different reference is inconclusive.
  const referenceOk =
    typeof txData.tx_ref === 'string' &&
    txData.tx_ref.length > 0 &&
    txData.tx_ref === params.txRef;
  const amountOk = Number.isFinite(Number(txData.amount));
  const currencyOk = typeof txData.currency === 'string' && txData.currency.length > 0;
  const statusOk = typeof txData.status === 'string' && txData.status.length > 0;
  const conclusive = referenceOk && amountOk && currencyOk && statusOk;
    return {
      // `verified` is true ONLY for a reliable, COMPLETE record — it mirrors
      // `conclusive` so callers can never mistake an incomplete 2xx record for a
      // verified payment (F-02.4: incomplete records must not be reported as
      // verified).
      verified: conclusive,
      conclusive,
    txRef: typeof txData.tx_ref === 'string' ? txData.tx_ref : '',
    amount: amountOk ? Number(txData.amount) : 0,
    currency: currencyOk ? txData.currency : '',
    status: statusOk ? txData.status : 'unknown',
    customerEmail: txData.customer?.email,
    reusableToken: txData.card?.token ?? null,
    raw: data,
  };
}

/**
 * Flutterwave returns a reusable card token on successful charges. Stored
 * on the Subscription so the renewal cron can charge it later unattended.
 */
export function extractReusableToken(webhookBody: any): string | null {
  return webhookBody?.data?.card?.token ?? null;
}

/**
 * Extracts the provider's transaction ID from a Flutterwave response.
 * Works for tokenized-charges response, verify response, and webhook payload.
 * All contain the transaction ID at `data.id`.
 */
export function extractProviderTransactionId(rawResponse: any): string | null {
  return rawResponse?.data?.id ?? null;
}
