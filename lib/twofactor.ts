import { authenticator } from 'otplib';

authenticator.options = { window: 1 }; // allow 1 step (~30s) of clock drift

export function generateSecret(): string {
  return authenticator.generateSecret();
}

export function generateOtpAuthUri(secret: string, email: string): string {
  return authenticator.keyuri(email, 'PredictPro', secret);
}

export function verifyTotpCode(secret: string, code: string): boolean {
  try {
    return authenticator.verify({ token: code, secret });
  } catch {
    return false;
  }
}
