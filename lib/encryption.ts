import crypto from 'crypto';

// Format: v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
const CIPHER_ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12; // 96 bits recommended for AES-GCM
const AUTH_TAG_LENGTH_BYTES = 16; // 128 bits
const VERSION_PREFIX = 'v1';

/**
 * Derives a valid 32-byte (256-bit) buffer key from the provided secret.
 * Accepts 64-character hex strings, 32-byte raw/base64 strings, or hashes long strings with SHA-256.
 */
function deriveKey(secretEnvVarName: string, explicitSecret?: string): Buffer {
  const secret = explicitSecret ?? process.env[secretEnvVarName] ?? process.env.ENCRYPTION_KEY;

  if (!secret || secret.trim().length === 0) {
    throw new Error(
      `Encryption key missing: ${secretEnvVarName} (or fallback ENCRYPTION_KEY) is required in environment variables.`,
    );
  }

  const trimmed = secret.trim();

  // If provided as 64-character hex string (32 bytes)
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, 'hex');
  }

  // If provided as exact 32-byte string
  if (Buffer.byteLength(trimmed, 'utf8') === 32) {
    return Buffer.from(trimmed, 'utf8');
  }

  // If shorter than 32 characters, reject in production for security, but allow hash derivation if >= 16 chars
  if (trimmed.length < 16) {
    throw new Error(
      `Encryption key for ${secretEnvVarName} is too short (must be at least 16 characters or 64 hex characters).`,
    );
  }

  // Deterministically hash to 32 bytes using SHA-256
  return crypto.createHash('sha256').update(trimmed).digest();
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function encrypt(plaintext: string, envVarName: string = 'PAYMENT_TOKEN_ENCRYPTION_KEY'): string {
  if (typeof plaintext !== 'string') {
    throw new Error('encrypt: plaintext must be a string');
  }

  const key = deriveKey(envVarName);
  const iv = crypto.randomBytes(IV_LENGTH_BYTES);
  const cipher = crypto.createCipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });

  let encrypted = cipher.update(plaintext, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag().toString('hex');
  const ivHex = iv.toString('hex');

  return `${VERSION_PREFIX}:${ivHex}:${authTag}:${encrypted}`;
}

/**
 * Decrypts a versioned AES-256-GCM ciphertext string.
 * Expects format: `v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>`
 */
export function decrypt(ciphertext: string, envVarName: string = 'PAYMENT_TOKEN_ENCRYPTION_KEY'): string {
  if (!ciphertext || typeof ciphertext !== 'string') {
    throw new Error('decrypt: ciphertext must be a non-empty string');
  }

  const parts = ciphertext.split(':');
  if (parts.length !== 4 || parts[0] !== VERSION_PREFIX) {
    throw new Error('decrypt: invalid ciphertext format (expected versioned v1:<iv>:<tag>:<data>)');
  }

  const [, ivHex, authTagHex, encryptedHex] = parts;
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('decrypt: corrupted ciphertext components');
  }

  const key = deriveKey(envVarName);
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');

  if (iv.length !== IV_LENGTH_BYTES || authTag.length !== AUTH_TAG_LENGTH_BYTES) {
    throw new Error('decrypt: invalid IV or authTag byte length');
  }

  const decipher = crypto.createDecipheriv(CIPHER_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH_BYTES });
  decipher.setAuthTag(authTag);

  try {
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    throw new Error('decrypt: authentication tag verification failed (bad key or tampered ciphertext)');
  }
}

/**
 * Convenience helper: Encrypt payment authorization tokens (Paystack authorization_code, Flutterwave card token)
 */
export function encryptPaymentToken(token: string): string {
  return encrypt(token, 'PAYMENT_TOKEN_ENCRYPTION_KEY');
}

/**
 * Convenience helper: Decrypt payment authorization tokens immediately before renewal charge
 */
export function decryptPaymentToken(encryptedToken: string): string {
  return decrypt(encryptedToken, 'PAYMENT_TOKEN_ENCRYPTION_KEY');
}

/**
 * Convenience helper: Encrypt TOTP base32 secret before writing to User database record
 */
export function encryptTotpSecret(secret: string): string {
  return encrypt(secret, 'TOTP_ENCRYPTION_KEY');
}

/**
 * Convenience helper: Decrypt TOTP secret before evaluating OTP code
 */
export function decryptTotpSecret(encryptedSecret: string): string {
  return decrypt(encryptedSecret, 'TOTP_ENCRYPTION_KEY');
}
