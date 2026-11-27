import { describe, it, expect, vi, afterEach } from 'vitest';
import { paystackInitialize } from '@/lib/providers/paystack';
import { flutterwaveInitialize } from '@/lib/providers/flutterwave';
import { ProviderInitError } from '@/lib/providers/init-error';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('provider initialization error classification', () => {
  it('Paystack: a completed rejection is a DEFINITIVE ProviderInitError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ message: 'invalid amount' }),
    })));

    await expect(paystackInitialize(paystackParams)).rejects.toMatchObject({ definitive: true });
    await expect(paystackInitialize(paystackParams)).rejects.toBeInstanceOf(ProviderInitError);
  });

  it('Paystack: a network failure is UNCERTAIN (not a ProviderInitError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('network down');
    }));

    await expect(paystackInitialize(paystackParams)).rejects.toThrow('network down');
    await expect(paystackInitialize(paystackParams)).rejects.not.toBeInstanceOf(ProviderInitError);
  });

  it('Paystack: success returns the authorization URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      statusText: 'OK',
      json: async () => ({ status: true, data: { authorization_url: 'https://checkout' } }),
    })));

    await expect(paystackInitialize(paystackParams)).resolves.toEqual({ authorizationUrl: 'https://checkout' });
  });

  it('Flutterwave: a completed rejection is a DEFINITIVE ProviderInitError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      statusText: 'Bad Request',
      json: async () => ({ message: 'invalid tx_ref' }),
    })));

    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toMatchObject({ definitive: true });
  });

  it('Flutterwave: a network failure is UNCERTAIN (not a ProviderInitError)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error('ETIMEDOUT');
    }));

    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.toThrow('ETIMEDOUT');
    await expect(flutterwaveInitialize(flutterwaveParams)).rejects.not.toBeInstanceOf(ProviderInitError);
  });

  it('Flutterwave: success returns the payment link', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      statusText: 'OK',
      json: async () => ({ status: 'success', data: { link: 'https://flutterwave.pay' } }),
    })));

    await expect(flutterwaveInitialize(flutterwaveParams)).resolves.toEqual({ paymentLink: 'https://flutterwave.pay' });
  });
});