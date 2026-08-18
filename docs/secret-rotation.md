# Secret Rotation Procedures

## Overview

This document defines safe rotation procedures for all sensitive secrets in the PredictionPro application. Rotation should be performed during maintenance windows with zero downtime when possible.

## General Principles

1. **Never rotate a secret in a way that breaks existing sessions** unless explicitly intended (e.g., password reset)
2. **Support overlapping validity periods** during rotation
3. **Verify rotation success** before decommissioning old secrets
4. **Document rotation timestamp** and responsible operator
5. **Test rotation in staging** before production

## Encryption Key Rotation (PAYMENT_TOKEN_ENCRYPTION_KEY, TOTP_ENCRYPTION_KEY, ENCRYPTION_KEY)

Encryption keys require special handling because existing encrypted data must remain readable.

### Key Versioning Strategy

```
v1 = old key (still used for decryption)
v2 = new key (used for all new encryption)
```

### Rotation Steps

1. **Deploy code changes** that support both v1 and v2 keys
   - Update encryption utilities to attempt v2 first, fall back to v1
   - New data is encrypted with v2
   - Existing v1 data remains readable

2. **Verify dual-key operation** in staging:
   - Encrypt new data → confirms v2 usage
   - Decrypt old data → confirms v1 fallback works

3. **Gradually migrate existing data** (if applicable):
   - Re-encrypt v1 records to v2 on next read/write
   - Or run a background migration job

4. **Remove v1 support** after all data is migrated:
   - Deploy code that only accepts v2
   - Archive v1 key securely

### Code Pattern

```typescript
// lib/encryption.ts
const keys = {
  v1: process.env.ENCRYPTION_KEY_V1,
  v2: process.env.ENCRYPTION_KEY_V2,
};

export async function encrypt(text: string): Promise<string> {
  // Always use current key for new data
  return encryptWithKey(text, keys.v2);
}

export async function decrypt(ciphertext: string, version?: number): Promise<string> {
  // Try current key first, fall back to older version
  if (version === 1 || isV1Ciphertext(ciphertext)) {
    return decryptWithKey(ciphertext, keys.v1);
  }
  return decryptWithKey(ciphertext, keys.v2);
}
```

## JWT Secret Rotation (JWT_ACCESS_SECRET, JWT_REFRESH_SECRET)

JWT secrets can be rotated with overlapping validity periods.

### Rotation Steps

1. **Add new secret** as environment variable:
   ```
   JWT_ACCESS_SECRET_V2=<new-secret>
   JWT_REFRESH_SECRET_V2=<new-secret>
   ```

2. **Deploy code changes** that accept both secrets:
   ```typescript
   function getAccessSecret(): Uint8Array {
     const secret = process.env.JWT_ACCESS_SECRET_V2 ?? process.env.JWT_ACCESS_SECRET;
     return requireSecret('JWT_ACCESS_SECRET', secret);
   }
   ```

3. **Verify**:
   - New tokens are signed with v2
   - Old tokens are still verified (JWT verify uses the correct secret based on header)

4. **Wait for old tokens to expire** (15 min access, 7 day refresh)

5. **Remove old secret** from environment

6. **Remove V2 fallback** from code on next deploy

## Cron Secret Rotation (CRON_SECRET)

1. Add new `CRON_SECRET_V2`
2. Update cron endpoint to accept both:
   ```typescript
   const validateCronSecret = (provided: string) => {
     const v1 = process.env.CRON_SECRET;
     const v2 = process.env.CRON_SECRET_V2;
     return timingSafeStringEqual(provided, v1) || timingSafeStringEqual(provided, v2);
   };
   ```
3. Update all cron job configurations to use new secret
4. Verify cron jobs still work
5. Remove old secret

## Payment Provider Secrets (PAYSTACK_SECRET_KEY, FLUTTERWAVE_SECRET_KEY)

1. Add new secret in provider dashboard
2. Update environment variable
3. Deploy code
4. Verify webhook signature validation works with new secret
5. Revoke old secret in provider dashboard

## Email Service Secret (RESEND_API_KEY)

1. Generate new API key in Resend dashboard
2. Update `RESEND_API_KEY` environment variable
3. Deploy code
4. Send test email to verify
5. Revoke old API key

## Object Storage Credentials (S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY)

1. Create new IAM user/credentials
2. Update environment variables
3. Deploy code
4. Test upload and signed URL generation
5. Revoke old credentials

## Redis Credentials (UPSTASH_REDIS_REST_URL, UPSTASH_REDIS_REST_TOKEN)

1. Create new Redis database in Upstash
2. Update environment variables
3. Deploy code
4. Verify rate limiting and caching work
5. Delete old Redis database

## Verification Checklist

After any rotation:
- [ ] New secrets are working in production
- [ ] Old secrets are revoked/deleted
- [ ] No errors in application logs
- [ ] Tests pass
- [ ] Security events are being logged correctly
- [ ] Rollback procedure is documented if issues arise

## Emergency Rotation

If a secret is compromised:
1. Immediately revoke/rotate the compromised secret
2. Deploy code changes if needed
3. Audit logs for any unauthorized usage
4. Notify security team
5. Review and update rotation schedule if needed
