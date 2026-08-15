import { authenticator } from 'otplib';
import { decryptTotpSecret } from './encryption';

authenticator.options = { window: 1 }; // allow 1 step (~30s) of clock drift

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function generateOtpAuthUri(secret: string, email: string): string {
  return authenticator.keyuri(email, 'PredictPro', secret);
}

export function verifyTotpCode(secretOrCiphertext: string, code: string): boolean {
  try {
    // If the secret stored in DB is encrypted (versioned v1:...), decrypt it server-side
    const plainSecret = secretOrCiphertext.startsWith('v1:')
      ? decryptTotpSecret(secretOrCiphertext)
      : secretOrCiphertext;

    return authenticator.verify({ token: code, secret: plainSecret });
  } catch {
    return false;
  }
}
