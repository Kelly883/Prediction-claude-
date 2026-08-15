import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptPaymentToken,
  decryptPaymentToken,
  encryptTotpSecret,
  decryptTotpSecret,
} from '@/lib/encryption';

describe('AES-256-GCM Encryption Utility (lib/encryption.ts)', () => {
  const originalPaymentKey = process.env.PAYMENT_TOKEN_ENCRYPTION_KEY;
  const originalTotpKey = process.env.TOTP_ENCRYPTION_KEY;

  beforeEach(() => {
    process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = 'test-payment-encryption-key-32-bytes-ok!';
    process.env.TOTP_ENCRYPTION_KEY = 'test-totp-encryption-key-32-bytes-long-ok!';
  });

  afterEach(() => {
    process.env.PAYMENT_TOKEN_ENCRYPTION_KEY = originalPaymentKey;
    process.env.TOTP_ENCRYPTION_KEY = originalTotpKey;
  });

  it('performs encrypt/decrypt round trip successfully for payment tokens', () => {
    const rawToken = 'AUTH_paystack_code_987654321_secret';
    const encrypted = encryptPaymentToken(rawToken);

    expect(encrypted).not.toBe(rawToken);
    expect(encrypted.startsWith('v1:')).toBe(true);

    const decrypted = decryptPaymentToken(encrypted);
    expect(decrypted).toBe(rawToken);
  });

  it('performs encrypt/decrypt round trip successfully for TOTP secrets', () => {
    const rawTotpSecret = 'JBSWY3DPEHPK3PXP';
    const encrypted = encryptTotpSecret(rawTotpSecret);

    expect(encrypted).not.toBe(rawTotpSecret);
    expect(encrypted.startsWith('v1:')).toBe(true);

    const decrypted = decryptTotpSecret(encrypted);
    expect(decrypted).toBe(rawTotpSecret);
  });

  it('generates unique random IVs/ciphertexts for the same plaintext across multiple calls', () => {
    const rawToken = 'FLW_CARD_TOKEN_123456';
    const enc1 = encryptPaymentToken(rawToken);
    const enc2 = encryptPaymentToken(rawToken);

    expect(enc1).not.toBe(enc2); // Nonce / IV must differ
    expect(decryptPaymentToken(enc1)).toBe(rawToken);
    expect(decryptPaymentToken(enc2)).toBe(rawToken);
  });

  it('fails decryption when decrypted with a wrong key (auth tag failure)', () => {
    const rawToken = 'AUTH_code_123';
    const encrypted = encrypt(rawToken, 'PAYMENT_TOKEN_ENCRYPTION_KEY');

    // Attempt to decrypt with TOTP key (which is different)
    expect(() => decrypt(encrypted, 'TOTP_ENCRYPTION_KEY')).toThrow(
      /authentication tag verification failed/i,
    );
  });

  it('fails decryption on corrupted / tampered ciphertext', () => {
    const rawToken = 'AUTH_code_123';
    const encrypted = encryptPaymentToken(rawToken);
    const parts = encrypted.split(':');

    // Tamper with the ciphertext component
    const tamperedCiphertext = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3].slice(0, -2)}ff`;

    expect(() => decryptPaymentToken(tamperedCiphertext)).toThrow(
      /authentication tag verification failed/i,
    );
  });

  it('fails decryption on invalid version prefix or format', () => {
    expect(() => decryptPaymentToken('invalid_format_string')).toThrow(/invalid ciphertext format/i);
    expect(() => decryptPaymentToken('v2:123:456:789')).toThrow(/invalid ciphertext format/i);
  });

  it('throws clear error when encryption key is missing', () => {
    delete process.env.PAYMENT_TOKEN_ENCRYPTION_KEY;
    delete process.env.ENCRYPTION_KEY;

    expect(() => encryptPaymentToken('token_without_key')).toThrow(
      /PAYMENT_TOKEN_ENCRYPTION_KEY.*is required/i,
    );
  });
});
