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

  const data = await res.json();
  if (!res.ok || !data.status) {
    throw new Error(`Paystack initialize failed: ${data.message ?? res.statusText}`);
  }
  return { authorizationUrl: data.data.authorization_url };
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
    return {
      verified: false,
      reference: params.reference,
      amount: 0,
      currency: '',
      status: data.data?.status ?? 'failed',
      raw: data,
    };
  }

  const txData = data.data;
  return {
    verified: true,
    reference: txData.reference,
    amount: Number(txData.amount) / 100,
    currency: txData.currency,
    status: txData.status,
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
