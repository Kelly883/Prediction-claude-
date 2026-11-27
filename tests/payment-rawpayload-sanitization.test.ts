import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { sanitizeRawPayload, redactPayload } from '@/lib/payments';
import { encryptPaymentToken, decryptPaymentToken } from '@/lib/encryption';

// Capture audit writes so we can prove credentials never reach the audit log.
const auditCalls: any[] = [];
vi.mock('@/lib/audit', () => ({
  writeAudit: vi.fn(async (params: any) => {
    auditCalls.push(params);
  }),
}));

// In-memory fake standing in for Prisma (mirrors webhook-idempotency harness).
function makeFakeDb() {
  const transactions = new Map<string, any>();
  const subscriptions = new Map<string, any>();
  let subIdCounter = 0;
  const user = { id: 'user-1', email: 'payer@example.com' };
  const plan = { id: 'plan-1', durationDays: 30, priceNGN: 4500, priceUSDOverride: null, fxMarkupPercent: null };

  const db: any = {
    transaction: {
      findUnique: vi.fn(async ({ where, include }: any) => {
        let found: any = null;
        if (where.providerReference) found = [...transactions.values()].find((t) => t.providerReference === where.providerReference) ?? null;
        else if (where.id) found = transactions.get(where.id) ?? null;
        if (found && include?.user) return { ...found, user };
        return found;
      }),
      findUniqueOrThrow: vi.fn(async ({ where, include }: any) => {
        let found: any = null;
        if (where.providerReference) found = [...transactions.values()].find((t) => t.providerReference === where.providerReference);
        else if (where.id) found = transactions.get(where.id);
        if (!found) throw new Error('Transaction not found');
        return include?.user ? { ...found, user } : found;
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        if (!existing) return { count: 0 };
        if (where.status?.in && !where.status.in.includes(existing.status)) return { count: 0 };
        transactions.set(where.id, { ...existing, ...data });
        return { count: 1 };
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = transactions.get(where.id);
        const updated = { ...existing, ...data };
        transactions.set(where.id, updated);
        return updated;
      }),
    },
    plan: { findUnique: vi.fn(async () => plan) },
    subscription: {
      findFirst: vi.fn(async () => [...subscriptions.values()][0] ?? null),
      create: vi.fn(async ({ data }: any) => {
        const id = `sub-${++subIdCounter}`;
        const record = { id, ...data };
        subscriptions.set(id, record);
        return record;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const existing = subscriptions.get(where.id);
        const updated = { ...existing, ...data };
        subscriptions.set(where.id, updated);
        return updated;
      }),
    },
    $transaction: vi.fn(async (fn: any) => fn(db)),
    _seed(tx: any) {
      transactions.set(tx.id, tx);
    },
    _getTransaction: (id: string) => transactions.get(id),
    _getSubscriptions: () => [...subscriptions.values()],
  };
  return db;
}

let fakeDb: ReturnType<typeof makeFakeDb>;

vi.mock('@/lib/prisma', () => ({
  get prisma() {
    return fakeDb;
  },
}));

const PAYSTACK_TOKEN = 'AUTH_pz_secret_reusable_code_123';
const FLUTTERWAVE_TOKEN = 'FLWSECK-card-token-xyz';

beforeEach(() => {
  fakeDb = makeFakeDb();
  auditCalls.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('sanitizeRawPayload (write-path control, F-01)', () => {
  it('drops nested Paystack authorization_code (data.authorization)', () => {
    const input = { event: 'charge.success', data: { reference: 'ref', amount: 4500, authorization: { authorization_code: PAYSTACK_TOKEN, reusable: true } } };
    const out: any = sanitizeRawPayload(input);
    expect(JSON.stringify(out)).not.toContain(PAYSTACK_TOKEN);
    expect(out.data.authorization).toBeUndefined();
    expect(out.data.reference).toBe('ref');
  });

  it('drops nested Flutterwave card.token (data.card)', () => {
    const input = { event: 'charge.completed', data: { tx_ref: 'ref', card: { token: FLUTTERWAVE_TOKEN, last4: '4242' } } };
    const out: any = sanitizeRawPayload(input);
    expect(JSON.stringify(out)).not.toContain(FLUTTERWAVE_TOKEN);
    expect(out.data.card).toBeUndefined();
  });

  it('drops credentials under alternative property names (reusableToken, token, raw)', () => {
    const input = { reusableToken: FLUTTERWAVE_TOKEN, nested: { token: PAYSTACK_TOKEN, raw: { authorization_code: PAYSTACK_TOKEN } } };
    const out: any = sanitizeRawPayload(input);
    const s = JSON.stringify(out);
    expect(s).not.toContain(PAYSTACK_TOKEN);
    expect(s).not.toContain(FLUTTERWAVE_TOKEN);
  });

  it('keeps ordinary non-sensitive metadata usable', () => {
    const input = { event: 'charge.success', reference: 'ref', amount: 4500, currency: 'NGN', status: 'success', customerEmail: 'a@b.com', data: { authorization: { authorization_code: PAYSTACK_TOKEN } } };
    const out: any = sanitizeRawPayload(input);
    expect(out.event).toBe('charge.success');
    expect(out.reference).toBe('ref');
    expect(out.amount).toBe(4500);
    expect(out.currency).toBe('NGN');
    expect(out.customerEmail).toBe('a@b.com');
    expect(out.data.authorization).toBeUndefined();
  });

  it('handles arrays of objects', () => {
    const out: any = sanitizeRawPayload([{ token: PAYSTACK_TOKEN, keep: 1 }]);
    expect(out[0].keep).toBe(1);
    expect(JSON.stringify(out)).not.toContain(PAYSTACK_TOKEN);
  });
});

describe('handleVerifiedWebhook never persists cleartext credentials', () => {
  it('Paystack webhook body: stores no authorization_code and still activates', async () => {
    fakeDb._seed({ id: 'tx-1', userId: 'user-1', planId: 'plan-1', provider: 'paystack', providerReference: 'ref-pz', amount: 4500, currency: 'NGN', status: 'pending' });
    const { handleVerifiedWebhook } = await import('@/lib/payments');
    const body = { event: 'charge.success', data: { reference: 'ref-pz', status: 'success', amount: 450000, currency: 'NGN', customer: { email: 'payer@example.com' }, authorization: { authorization_code: PAYSTACK_TOKEN, reusable: true } } };

    await handleVerifiedWebhook({ providerReference: 'ref-pz', status: 'success', amountPaid: 4500, currencyPaid: 'NGN', customerEmail: 'payer@example.com', rawPayload: body, renewalToken: PAYSTACK_TOKEN });

    const stored = fakeDb._getTransaction('tx-1');
    expect(stored.status).toBe('success');
    expect(JSON.stringify(stored.rawPayload)).not.toContain(PAYSTACK_TOKEN);
    expect(fakeDb._getSubscriptions().length).toBe(1);
    // renewal token is encrypted at rest on the subscription, never in rawPayload
    expect(stored.rawPayload).not.toHaveProperty('authorization');
  });

  it('Flutterwave webhook payload: stores no card.token and still activates', async () => {
    fakeDb._seed({ id: 'tx-2', userId: 'user-1', planId: 'plan-1', provider: 'flutterwave', providerReference: 'ref-flw', amount: 4500, currency: 'NGN', status: 'pending' });
    const { handleVerifiedWebhook } = await import('@/lib/payments');
    const rawPayload = { webhook: { event: 'charge.completed', data: { tx_ref: 'ref-flw', card: { token: FLUTTERWAVE_TOKEN } } } };

    await handleVerifiedWebhook({ providerReference: 'ref-flw', status: 'success', amountPaid: 4500, currencyPaid: 'NGN', customerEmail: 'payer@example.com', rawPayload, renewalToken: FLUTTERWAVE_TOKEN });

    const stored = fakeDb._getTransaction('tx-2');
    expect(stored.status).toBe('success');
    expect(JSON.stringify(stored.rawPayload)).not.toContain(FLUTTERWAVE_TOKEN);
    expect(fakeDb._getSubscriptions().length).toBe(1);
  });

  it('mismatch path also stores a sanitized payload (no cleartext)', async () => {
    fakeDb._seed({ id: 'tx-3', userId: 'user-1', planId: 'plan-1', provider: 'paystack', providerReference: 'ref-pz-3', amount: 4500, currency: 'NGN', status: 'pending' });
    const { handleVerifiedWebhook } = await import('@/lib/payments');
    const body = { data: { authorization: { authorization_code: PAYSTACK_TOKEN } } };
    await expect(
      handleVerifiedWebhook({ providerReference: 'ref-pz-3', status: 'success', amountPaid: 9999, currencyPaid: 'NGN', rawPayload: body })
    ).rejects.toThrow(/mismatch/i);
    const stored = fakeDb._getTransaction('tx-3');
    expect(JSON.stringify(stored.rawPayload)).not.toContain(PAYSTACK_TOKEN);
  });

  it('does not write credentials to the audit log', async () => {
    fakeDb._seed({ id: 'tx-4', userId: 'user-1', planId: 'plan-1', provider: 'paystack', providerReference: 'ref-pz-4', amount: 4500, currency: 'NGN', status: 'pending' });
    const { handleVerifiedWebhook } = await import('@/lib/payments');
    await handleVerifiedWebhook({ providerReference: 'ref-pz-4', status: 'success', amountPaid: 4500, currencyPaid: 'NGN', customerEmail: 'payer@example.com', rawPayload: { data: { authorization: { authorization_code: PAYSTACK_TOKEN } } }, renewalToken: PAYSTACK_TOKEN });
    expect(auditCalls.length).toBeGreaterThan(0);
    for (const call of auditCalls) {
      expect(JSON.stringify(call.metadata ?? {})).not.toContain(PAYSTACK_TOKEN);
    }
  });
});

describe('read-path redaction (defence-in-depth for legacy rows)', () => {
  it('redactPayload masks cleartext credentials on the way out', () => {
    const legacy = { data: { authorization: { authorization_code: PAYSTACK_TOKEN }, card: { token: FLUTTERWAVE_TOKEN } }, reference: 'ref' };
    const out: any = redactPayload(legacy);
    const s = JSON.stringify(out);
    expect(s).not.toContain(PAYSTACK_TOKEN);
    expect(s).not.toContain(FLUTTERWAVE_TOKEN);
    expect(out.reference).toBe('ref');
  });
});

describe('renewal credential encryption (F-01 preservation)', () => {
  const KEY_ENV = 'PAYMENT_TOKEN_ENCRYPTION_KEY';
  const FALLBACK_ENV = 'ENCRYPTION_KEY';
  let savedKey: string | undefined;
  let savedFallback: string | undefined;

  beforeEach(() => {
    savedKey = process.env[KEY_ENV];
    savedFallback = process.env[FALLBACK_ENV];
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env[KEY_ENV];
    else process.env[KEY_ENV] = savedKey;
    if (savedFallback === undefined) delete process.env[FALLBACK_ENV];
    else process.env[FALLBACK_ENV] = savedFallback;
  });

  it('round-trips a reusable token through authenticated encryption', () => {
    const cipher = encryptPaymentToken(PAYSTACK_TOKEN);
    expect(cipher).not.toContain(PAYSTACK_TOKEN);
    expect(cipher.startsWith('v1:')).toBe(true);
    expect(decryptPaymentToken(cipher)).toBe(PAYSTACK_TOKEN);
  });

  it('fails closed when no encryption key is available', () => {
    delete process.env[KEY_ENV];
    delete process.env[FALLBACK_ENV];
    expect(() => encryptPaymentToken(PAYSTACK_TOKEN)).toThrow(/key/i);
  });

  it('rejects tampered/invalid ciphertext (integrity verification)', () => {
    const cipher = encryptPaymentToken(PAYSTACK_TOKEN);
    const parts = cipher.split(':');
    parts[3] = parts[3].replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    expect(() => decryptPaymentToken(parts.join(':'))).toThrow();
    expect(() => decryptPaymentToken('not-a-valid-ciphertext')).toThrow();
  });
});