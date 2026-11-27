import { describe, it, expect, vi, afterEach } from 'vitest';
import { paystackInitialize } from '@/lib/providers/paystack';
import { flutterwaveInitialize } from '@/lib/providers/flutterwave';
import { ProviderInitError, isDefinitiveRejection } from '@/lib/providers/init-error';

const paystackParams = {
  email: 'a@b.com',
  amountMinorUnits: 450000,
  currency: 'NGN',
  reference: 'pp_x',
  callbackUrl: 'https://app.test/cb',
};
const flutterwaveParams = {
  txRef: 'pp_x',
  amount: 4500,
  currency: 'NGN',
  redirectUrl: 'https://app.test/cb',
  customerEmail: 'a@b.com',
};

function stubFetch(status: number, body: unknown, ok = status >= 200 && status < 300) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('isDefinitiveRejection', () => {
  it('treats only 4xx (except 408/429) as definitive', () => {
    expect(isDefinitiveRejection(400)).toBe(true);
    expect(isDefinitiveRejection(401)).toBe(true);
    expect(isDefinitiveRejection(403)).toBe(true);
    expect(isDefinitiveRejection(404)).toBe(true);
    expect(isDefinitiveRejection(422)).toBe(true);
    expect(isDefinitiveRejection(408)).toBe(false);
    expect(isDefinitiveRejection(429)).toBe(false);
    expect(isDefinitiveRejection(500)).toBe(false);
    expect(isDefinitiveRejection(502)).toBe(false);
    expect(isDefinitiveRejection(503)).toBe(false);
  });
});

describe('provider initialization error classification', () => {
  it('Paystack: 408/429/5xx are UNCERTAIN (definitive=false)', async () => {
    for (const status of [408, 429, 500, 502, 503]) {
      stubFetch(status, { message: 'ambiguous' });
      await expect(paystackInitialize(paystackParams)).rejects.toMatchObject({ definitive: false });
      await expect(paystackInitialize(paystackParams)).rejects.toBeInstanceOf(ProviderInitError);
    }
  });

  it('Paystack: 4xx (except 408/429) are DEFINITIVE (definitive=true)', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      stubFetch(status, { message: 'rejected' });
      await expect(paystackInitialize(paystackParams)).rejects.toMatchObject({ definitive: true });
    }
  });

  it('Paystack: malformed/incomplete 2xx is UNCERTAIN', async () => {
    stubFetch(200, { status: true, data: {} }); // no authorization_url
    await expect(paystackInitialize(paystackParams)).rejects.toMatchObject({ definitive: false });
  });

  it('Paystack: network failure is UNCERTAIN (not a ProviderInitError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await expect(paystackInitialize(paystackParams)).rejects.toThrow('network down');
    await expect(paystackInitialize(paystackParams)).rejects.not.toBeInstanceOf(ProviderInitError);
  });

  it('Paystack: success returns the authorization URL', async () => {
    stubFetch(200, { status: true, data: { authorization_url: 'https://checkout' } });
    await expect(paystackInitialize(paystackParams)).resolves.toEqual({ authorizationUrl: 'https://checkout' });
  });

  it('Flutterwave: 408/429/5xx are UNCERTAIN (definitive=false)', async () => {
    for (const status of [408, 429, 500, 502, 503]) {
      stubFetch(status, { message: 'ambiguous' });
      await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toMatchObject({ definitive: false });
    }
  });

  it('Flutterwave: 4xx (except 408/429) are DEFINITIVE (definitive=true)', async () => {
    for (const status of [400, 401, 403, 404, 422]) {
      stubFetch(status, { message: 'rejected' });
      await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toMatchObject({ definitive: true });
    }
  });

  it('Flutterwave: malformed/incomplete 2xx is UNCERTAIN', async () => {
    stubFetch(200, { status: 'success', data: {} }); // no link
    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toMatchObject({ definitive: false });
  });

  it('Flutterwave: network failure is UNCERTAIN (not a ProviderInitError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ETIMEDOUT'); }));
    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toThrow('ETIMEDOUT');
    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.not.toBeInstanceOf(ProviderInitError);
  });

  it('Flutterwave: success returns the payment link', async () => {
    stubFetch(200, { status: 'success', data: { link: 'https://flutterwave.pay' } });
    await expect(flutterwaveInitialize(flutterwaveParams)).resolves.toEqual({ paymentLink: 'https://flutterwave.pay' });
  });
});