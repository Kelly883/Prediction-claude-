import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { paystackVerifyTransaction } from '@/lib/providers/paystack';
import { flutterwaveVerifyTransaction } from '@/lib/providers/flutterwave';

// These tests exercise the REAL provider verification functions with a mocked
// `fetch` (no live provider calls). They prove how each provider classifies a
// response into conclusive / inconclusive, which the renewal cron relies on.

function res(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body } as any;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  process.env.PAYSTACK_SECRET_KEY = 'sk_test';
  process.env.FLUTTERWAVE_SECRET_KEY = 'flw_test';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Paystack verify classification', () => {
  it('1. HTTP 200 confirmed success → conclusive + verified', async () => {
    fetchMock.mockResolvedValue(
      res({ status: true, data: { reference: 'r1', amount: 500000, currency: 'NGN', status: 'success', customer: { email: 'a@b.c' } } }),
    );
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(true);
    expect(v.verified).toBe(true);
    expect(v.status).toBe('success');
  });

  it('2. HTTP 200 confirmed definitive failure → conclusive, status failed', async () => {
    fetchMock.mockResolvedValue(res({ status: true, data: { reference: 'r1', amount: 0, currency: 'NGN', status: 'failed' } }));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(true);
    expect(v.verified).toBe(true);
    expect(v.status).toBe('failed');
  });

  it('3. HTTP 500 → inconclusive (not definitive)', async () => {
    fetchMock.mockResolvedValue(res({ status: false, message: 'boom' }, false, 500));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
    expect(v.verified).toBe(false);
  });

  it('4. HTTP 502/503 → inconclusive', async () => {
    fetchMock.mockResolvedValueOnce(res({ status: false }, false, 502));
    fetchMock.mockResolvedValueOnce(res({ status: false }, false, 503));
    expect((await paystackVerifyTransaction({ reference: 'r1' })).conclusive).toBe(false);
    expect((await paystackVerifyTransaction({ reference: 'r1' })).conclusive).toBe(false);
  });

  it('5. network exception → throws (caller maps to unknown)', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(paystackVerifyTransaction({ reference: 'r1' })).rejects.toThrow();
  });

  it('6. timeout → throws (caller maps to unknown)', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(paystackVerifyTransaction({ reference: 'r1' })).rejects.toThrow();
  });

  it('7. malformed response → inconclusive', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as any);
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('8. missing transaction status → inconclusive (incomplete record)', async () => {
    fetchMock.mockResolvedValue(res({ status: true, data: { reference: 'r1', amount: 0, currency: 'NGN' } }));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('9. partial 2xx success without a transaction reference → inconclusive', async () => {
    fetchMock.mockResolvedValue(res({ status: true, data: { amount: 500000, currency: 'NGN', status: 'success' } }));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('10. missing amount → inconclusive', async () => {
    fetchMock.mockResolvedValue(res({ status: true, data: { reference: 'r1', currency: 'NGN', status: 'success' } }));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('11. record for a DIFFERENT reference → inconclusive (not success)', async () => {
    fetchMock.mockResolvedValue(res({ status: true, data: { reference: 'other', amount: 500000, currency: 'NGN', status: 'success' } }));
    const v = await paystackVerifyTransaction({ reference: 'r1' });
    expect(v.conclusive).toBe(false);
  });
});

describe('Flutterwave verify classification', () => {
  it('1. HTTP 200 confirmed success → conclusive + verified', async () => {
    fetchMock.mockResolvedValue(
      res({ status: 'success', data: { tx_ref: 'r1', amount: 5000, currency: 'NGN', status: 'successful', card: { token: 't' } } }),
    );
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(true);
    expect(v.verified).toBe(true);
    expect(v.status).toBe('successful');
  });

  it('2. HTTP 200 confirmed definitive failure → conclusive, status failed', async () => {
    fetchMock.mockResolvedValue(res({ status: 'success', data: { tx_ref: 'r1', amount: 0, currency: 'NGN', status: 'failed' } }));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(true);
    expect(v.status).toBe('failed');
  });

  it('3. HTTP 500 → inconclusive', async () => {
    fetchMock.mockResolvedValue(res({ status: 'error', message: 'boom' }, false, 500));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
    expect(v.verified).toBe(false);
  });

  it('4. HTTP 502/503 → inconclusive', async () => {
    fetchMock.mockResolvedValueOnce(res({ status: 'error' }, false, 502));
    fetchMock.mockResolvedValueOnce(res({ status: 'error' }, false, 503));
    expect((await flutterwaveVerifyTransaction({ txRef: 'r1' })).conclusive).toBe(false);
    expect((await flutterwaveVerifyTransaction({ txRef: 'r1' })).conclusive).toBe(false);
  });

  it('5. network exception → throws', async () => {
    fetchMock.mockRejectedValue(new Error('ECONNRESET'));
    await expect(flutterwaveVerifyTransaction({ txRef: 'r1' })).rejects.toThrow();
  });

  it('6. timeout → throws', async () => {
    fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'));
    await expect(flutterwaveVerifyTransaction({ txRef: 'r1' })).rejects.toThrow();
  });

  it('7. malformed response → inconclusive', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } } as any);
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('8. missing transaction status → inconclusive (incomplete record)', async () => {
    fetchMock.mockResolvedValue(res({ status: 'success', data: { tx_ref: 'r1', amount: 0, currency: 'NGN' } }));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('9. partial 2xx success without a tx_ref → inconclusive', async () => {
    fetchMock.mockResolvedValue(res({ status: 'success', data: { amount: 5000, currency: 'NGN', status: 'successful' } }));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('10. missing amount → inconclusive', async () => {
    fetchMock.mockResolvedValue(res({ status: 'success', data: { tx_ref: 'r1', currency: 'NGN', status: 'successful' } }));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
  });

  it('11. record for a DIFFERENT tx_ref → inconclusive (not success)', async () => {
    fetchMock.mockResolvedValue(res({ status: 'success', data: { tx_ref: 'other', amount: 5000, currency: 'NGN', status: 'successful' } }));
    const v = await flutterwaveVerifyTransaction({ txRef: 'r1' });
    expect(v.conclusive).toBe(false);
  });
});