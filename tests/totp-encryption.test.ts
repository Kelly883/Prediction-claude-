import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { generateSecret, verifyTotpCode } from '@/lib/twofactor';
import { encryptTotpSecret, decryptTotpSecret } from '@/lib/encryption';
import { authenticator } from 'otplib';

describe('TOTP Secrets Encryption & Verification', () => {
  beforeEach(() => {
    process.env.TOTP_ENCRYPTION_KEY = 'test-totp-encryption-key-32-bytes-long-ok!';
  });

  it('verifies TOTP codes when secret is stored as ciphertext in database', () => {
    const plainSecret = generateSecret();
    const encryptedSecret = encryptTotpSecret(plainSecret);

    expect(encryptedSecret.startsWith('v1:')).toBe(true);

    // Generate valid TOTP token for current window
    const validCode = authenticator.generate(plainSecret);

    // verifyTotpCode accepts the encrypted database string, decrypts it internally, and validates code
    const isCodeValid = verifyTotpCode(encryptedSecret, validCode);
    expect(isCodeValid).toBe(true);

    // Rejects invalid code
    const isInvalidCodeValid = verifyTotpCode(encryptedSecret, '000000');
    expect(isInvalidCodeValid).toBe(false);
  });

  it('2FA setup route encrypts secret before saving and returns plaintext only once', async () => {
    let savedUserInDb: any = null;

    vi.doMock('@/lib/prisma', () => ({
      prisma: {
        user: {
          findUniqueOrThrow: vi.fn(async () => ({ id: 'user-123', email: 'totp@example.com' })),
          update: vi.fn(async ({ data }: any) => {
            savedUserInDb = data;
            return { id: 'user-123', ...data };
          }),
        },
      },
    }));

    vi.doMock('@/lib/rbac', () => ({
      requireUser: vi.fn(async () => ({ sub: 'user-123', role: 'user' })),
      errorResponse: (err: any) => NextResponse.json({ error: (err as Error).message }, { status: 500 }),
    }));

    const { POST: setup2fa } = await import('@/app/api/auth/2fa/setup/route');
    const req = new NextRequest('http://localhost/api/auth/2fa/setup', { method: 'POST' });

    const res = await setup2fa(req);
    expect(res.status).toBe(200);
    const json = await res.json();

    expect(json.secret).toBeDefined();
    expect(json.otpauthUri).toBeDefined();

    // Database record MUST store ciphertext, NOT plaintext secret
    expect(savedUserInDb.twoFactorSecret).toBeDefined();
    expect(savedUserInDb.twoFactorSecret.startsWith('v1:')).toBe(true);
    expect(savedUserInDb.twoFactorSecret).not.toBe(json.secret);

    // Decrypting the database record reproduces the setup secret
    expect(decryptTotpSecret(savedUserInDb.twoFactorSecret)).toBe(json.secret);
  });
});
