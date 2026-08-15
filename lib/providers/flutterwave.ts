const BASE_URL = 'https://api.flutterwave.com/v3';

function headers() {
  return {
    Authorization: `Bearer ${process.env.FLUTTERWAVE_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };
}

interface InitializeParams {
  txRef: string;
  amount: number; // major units — Flutterwave, unlike Paystack, wants e.g. 5000.00 not 500000
  currency: string;
  redirectUrl: string;
  customerEmail: string;
}

export async function flutterwaveInitialize(params: InitializeParams): Promise<{ paymentLink: string }> {
  const res = await fetch(`${BASE_URL}/payments`, {
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

  const data = await res.json();
  if (!res.ok || data.status !== 'success') {
    throw new Error(`Flutterwave initialize failed: ${data.message ?? res.statusText}`);
  }
  return { paymentLink: data.data.link };
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
  const res = await fetch(`${BASE_URL}/tokenized-charges`, {
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

  const res = await fetch(url, {
    method: 'GET',
    headers: headers(),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.status !== 'success' || !data.data) {
    return {
      verified: false,
      txRef: params.txRef ?? '',
      amount: 0,
      currency: '',
      status: 'failed',
      raw: data,
    };
  }

  const txData = data.data;
  return {
    verified: true,
    txRef: txData.tx_ref,
    amount: Number(txData.amount),
    currency: txData.currency,
    status: txData.status, // e.g. 'successful'
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
