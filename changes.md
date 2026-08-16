# PredictPro — Flow-by-Flow Security Audit & Remediation Plan

**Date:** 2026-08-16  
**Auditor:** Kilo  
**Scope:** Next.js 15 app using JWT access/refresh tokens, Prisma, server-side API routes  
**Methodology:** Static analysis of all route handlers, libraries, middleware, Prisma schema, and frontend pages

---

## 1. Executive Summary

PredictPro implements a strong baseline of security controls: bcrypt password hashing (cost 12), JWT access/refresh tokens with `tokenVersion` revocation, account lockout (5 attempts / 30 min), password rehashing on login, timing-safe secret comparisons, dual fail-closed rate limiting (IP + normalized identifier), atomic payment webhook processing, AES-256-GCM encryption for payment tokens and TOTP secrets, admin bootstrap with secret + atomic transaction, and comprehensive audit logging.

This audit identified **20 security gaps** across the 10 flows. The most critical finding is that `lib/auth.ts:18-21` silently falls back to a hardcoded development JWT secret when `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is missing or undersized, enabling JWT forgery in production. Other high-impact gaps include missing Content-Security-Policy headers, unredacted sensitive payment payloads returned to users, no CSRF protection on state-changing endpoints, and lack of refresh token rotation.

---

## 2. Authentication & Session Flows

### Current Behavior

- **Register** (`app/api/auth/register/route.ts`): Validates via `RegisterSchema`, hashes password with bcryptjs cost 12, creates user with `role: 'user'`. Dual rate-limited by IP + normalized email, fail-closed.
- **Login** (`app/api/auth/login/route.ts`): Validates via `LoginSchema`, verifies password, issues access (15m) + refresh (7d) tokens. Handles 2FA challenge, account lockout, password rehashing, session tracking, anomaly detection. Generic 401 on failure.
- **Refresh** (`app/api/auth/refresh/route.ts`): Exchanges refresh token for new access token. Enforces `tokenVersion` check to reject revoked sessions.
- **Logout** (`app/api/auth/logout/route.ts`): Deletes both cookies client-side.
- **Password Reset** (`app/api/auth/password-reset/request/route.ts` + `confirm/route.ts`): Request creates SHA-256 hashed token (30min TTL), sends email. Confirm validates token, hashes new password, increments `tokenVersion`, deletes all sessions, marks token used. Atomic transaction.
- **2FA** (`app/api/auth/2fa/setup/verify/disable/login-verify/route.ts`): Setup generates TOTP secret, encrypts with AES-256-GCM, returns plaintext once. Verify confirms code before enabling. Disable requires password or valid TOTP. Login-verify exchanges challenge token + TOTP for real session.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| A1 | **P0** | `lib/auth.ts:18-21` — `requireSecret` silently falls back to hardcoded development secret `predictpro-development-jwt-secret-key-at-least-32-chars-long` when env var is missing or < 32 chars. Comment claims it "throws loudly" but code does not. |
| A2 | **P1** | No refresh token rotation. Same refresh token can be reused indefinitely. If stolen, attacker has 7-day window. |
| A3 | **P1** | `app/api/auth/2fa/login-verify/route.ts:16` — Rate limits only by IP, not by user ID. Distributed attackers can rotate IPs to bypass. |
| A4 | **P2** | No email verification. Users can register with emails they don't own. |
| A5 | **P2** | Password reset confirms only enforce min 8 chars, no complexity/breach check. |
| A6 | **P2** | `app/api/auth/password-reset/confirm/route.ts` — No rate limit on confirm endpoint, only on request. |

### Recommended Changes

**A1 — lib/auth.ts:18-21**
```typescript
function requireSecret(name: string, value: string | undefined): Uint8Array {
  if (!value || value.length < 32) {
    throw new Error(`Missing or undersized JWT secret: ${name}. Set a value >= 32 characters.`);
  }
  return encoder.encode(value);
}
```
Remove the hardcoded fallback entirely. Add a build-time check or health endpoint that verifies both secrets are configured.

**A2 — app/api/auth/refresh/route.ts + lib/auth.ts**
Implement refresh token rotation:
- On refresh, invalidate the old refresh token (store a `refreshTokenVersion` or `tokenFamily` in DB).
- Issue a new refresh token alongside the new access token.
- Reject reuse of a previously-used refresh token.

**A3 — app/api/auth/2fa/login-verify/route.ts:16**
```typescript
const allowed = await checkRateLimit(authLimiter, [ip, `user:${user.id}`]);
```
Rate limit by both IP and user ID, consistent with other 2FA routes.

**A4 — Add email verification**
- Add `emailVerifiedAt` to `User` model.
- Generate email verification token on registration.
- Require verification before allowing login (or after X hours).
- Add route `POST /api/auth/verify-email`.

**A5 — lib/schemas.ts + password-strength.ts**
Strengthen `ChangePasswordSchema` and password reset validation:
```typescript
password: z.string().min(12).regex(/[A-Z]/, 'uppercase').regex(/[a-z]/, 'lowercase').regex(/[0-9]/, 'number')
```
Add breach check against HaveIBeenPwned k-anonymity API (optional but recommended).

**A6 — app/api/auth/password-reset/confirm/route.ts**
Add rate limiting:
```typescript
const allowed = await checkRateLimit(authLimiter, [ip, `user:${record.userId}`]);
```

### Missing Tests / Migrations

- Test that `requireSecret` throws when env vars are missing/short.
- Test refresh token rotation and reuse rejection.
- Test 2FA login-verify rate limiting by user ID.
- Migration: add `emailVerifiedAt` to `User` if implementing email verification.

---

## 3. Authorization & Access Control Flows

### Current Behavior

- **Middleware** (`middleware.ts`): UX guard only — redirects non-admins from `/admin`, non-users from `/dashboard`, logged-in users from auth pages. Not the security boundary.
- **RBAC** (`lib/rbac.ts`): `requireUser` extracts JWT from cookie, verifies signature. `requireAdmin` checks role. `optionalUser` for public endpoints.
- **Entitlement** (`lib/entitlement.ts`): Server-side paywall. Priority: admin bypass → complimentary access → active free rule → post.freeUntil → active subscription covering category. `toTeaser()` strips sensitive fields.
- **Predictions** (`app/api/predictions/route.ts`, `app/api/predictions/[id]/route.ts`): Requires auth, calls `canView` server-side.
- **Media** (`app/api/media/[id]/raw/route.ts`, `app/api/media/[id]/signed-url/route.ts`): Requires auth, calls `canView` before serving.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| B1 | **P1** | No CSRF protection on state-changing endpoints. Only image upload (`app/api/admin/predictions/[id]/images/route.ts:21-33`) checks `origin` vs `host`. All other POST/PATCH/DELETE endpoints lack CSRF tokens. |
| B2 | **P1** | `app/api/me/payments/route.ts` — Returns raw transaction `rawPayload` without redaction. May expose payment provider secrets, auth codes, or tokens. |
| B3 | **P1** | `app/api/admin/users/[id]/route.ts:20-23` — Returns user transactions without redacting `rawPayload`. Same exposure as B2. |
| B4 | **P2** | No concurrent session limits. `lib/sessions.ts` tracks devices and detects anomalies but never enforces a maximum. |
| B5 | **P2** | `middleware.ts` is not the security boundary but could give a false sense of security if developers forget server-side checks. |

### Recommended Changes

**B1 — Implement CSRF protection**
- Add `csrf.ts` library generating/validating double-submit cookies or SameSite+CSRF token pair.
- For same-origin SPAs, `sameSite: 'lax'` provides some protection, but add explicit CSRF tokens for all state-changing operations.
- Apply middleware that validates `x-csrf-token` header on POST/PATCH/DELETE.

**B2 — app/api/me/payments/route.ts**
```typescript
import { redactPayload } from '@/lib/payments'; // extract from admin/transactions/route.ts
// ...
return NextResponse.json(payments.map(tx => ({ ...tx, rawPayload: redactPayload(tx.rawPayload) })));
```

**B3 — app/api/admin/users/[id]/route.ts**
```typescript
const safeTransactions = transactions.map(tx => ({ ...tx, rawPayload: redactPayload(tx.rawPayload) }));
return NextResponse.json({ user, subscriptions: safeSubscriptions, transactions: safeTransactions, ... });
```

**B4 — lib/sessions.ts + app/api/auth/login/route.ts**
Enforce max concurrent sessions (e.g., 5):
```typescript
const MAX_SESSIONS = 5;
const sessionCount = await prisma.userSession.count({ where: { userId } });
if (sessionCount >= MAX_SESSIONS) {
  await prisma.userSession.deleteMany({ where: { userId, lastSeenAt: { lt: cutoff } } });
  // or reject login with 403
}
```

### Missing Tests / Migrations

- Test CSRF token validation on all state-changing endpoints.
- Test that `rawPayload` is redacted in `/api/me/payments` and admin user detail.
- Test concurrent session enforcement.

---

## 4. Payment Flows

### Current Behavior

- **Initialize** (`app/api/payments/initialize/route.ts`): Requires auth, rate-limited (fail-closed) by IP + user ID. Resolves price server-side. Generates `idempotencyKey` (`crypto.randomUUID()`), reference `pp_<uuid>`. Stores `Transaction` with `status: 'pending'`.
- **Webhooks** (`app/api/payments/webhook/paystack/route.ts`, `app/api/payments/webhook/flutterwave/route.ts`): Reads raw body first for signature verification. Paystack: HMAC-SHA512. Flutterwave: independent API verification + `verif-hash` check. Validates amount, currency, customer email against DB. Atomic transition via `updateMany`.
- **Callback** (`app/payments/callback/page.tsx`): Polls `/api/payments/status` for result.
- **Status** (`app/api/payments/status/route.ts`): Scoped to logged-in user's own transactions.
- **Cancel Auto-Renew** (`app/api/payments/cancel-auto-renew/route.ts`): Sets `autoRenew: false`, strips `renewalAuthCode`.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| C1 | **P1** | `app/api/me/payments/route.ts` exposes raw `Transaction` rows including `rawPayload` with unredacted payment provider data. |
| C2 | **P1** | `app/api/admin/users/[id]/route.ts` exposes user transactions with unredacted `rawPayload`. |
| C3 | **P2** | No `Cache-Control` headers on payment/status endpoints. Sensitive payment data may be cached by proxies or browsers. |
| C4 | **P2** | Webhook handlers are synchronous. Under high load, they may timeout before completing DB writes. |

### Recommended Changes

**C1/C2 — See B2/B3 above.** Redact `rawPayload` using the existing `redactPayload` function from `app/api/admin/transactions/route.ts`.

**C3 — Add Cache-Control headers**
```typescript
return NextResponse.json(data, {
  headers: { 'Cache-Control': 'private, no-store' }
});
```

**C4 — Consider async webhook processing**
- Queue webhook payloads to Redis/queue for background processing.
- Return 200 immediately after enqueueing.
- This prevents provider retries from causing duplicate processing.

### Missing Tests / Migrations

- Test rawPayload redaction in user payment history.
- Test rawPayload redaction in admin user detail transactions.

---

## 5. Admin Bootstrap & Onboarding Flows

### Current Behavior

- **Admin Setup** (`app/api/auth/admin-setup/route.ts`): GET returns `isSetupAvailable` and `adminCount`. POST requires `ADMIN_BOOTSTRAP_SECRET` in production (or when `NODE_ENV !== 'production'` without secret). Creates admin within atomic transaction. Auto-logs in admin.
- **Admin Users** (`app/api/admin/users/route.ts`): GET lists users with safe fields. POST creates user with default password `'PredictPro@2026'` if none provided.
- **Admin Unlock** (`app/api/admin/users/[id]/route.ts`): PATCH with `action: 'unlock'` resets `failedLoginAttempts` and `lockedUntil`.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| D1 | **P1** | `app/api/auth/admin-setup/route.ts:16-19` — Bootstrap is allowed without secret when `NODE_ENV !== 'production'`. Preview/staging deployments (Vercel sets `NODE_ENV=preview`) are vulnerable. |
| D2 | **P1** | Admin bootstrap auto-logs in the new admin without forcing a password change. The admin gets a 7-day refresh token with the default/bootstrapped password. |
| D3 | **P1** | `app/api/admin/users/route.ts:154` — Default password `'PredictPro@2026'` is hardcoded and publicly visible in the source. |
| D4 | **P2** | `app/api/auth/admin-setup/route.ts:29-48` — GET endpoint leaks `adminCount`, helping attackers determine if an admin exists. |
| D5 | **P2** | No password strength enforcement for admin-created users. |

### Recommended Changes

**D1 — app/api/auth/admin-setup/route.ts:16-19**
```typescript
function verifyBootstrapSecret(req: NextRequest): boolean {
  const secret = process.env.ADMIN_BOOTSTRAP_SECRET;
  if (!secret) {
    // Disable bootstrap entirely unless explicitly allowed via env var
    return process.env.ALLOW_ADMIN_BOOTSTRAP_WITHOUT_SECRET === 'true';
  }
  // ...
}
```
Remove the `NODE_ENV !== 'production'` fallback. Require explicit opt-in via `ALLOW_ADMIN_BOOTSTRAP_WITHOUT_SECRET`.

**D2 — app/api/auth/admin-setup/route.ts**
After creating admin, require password change before issuing session:
```typescript
const res = NextResponse.json({ success: true, id: admin.id, requirePasswordChange: true });
// Do NOT set cookies; redirect to /reset-password?token=... or force change on first login
```

**D3 — app/api/admin/users/route.ts:154**
```typescript
const defaultPassword = password || crypto.randomBytes(16).toString('hex');
// Or reject creation without explicit password
if (!password) throw new ApiError(400, 'Password is required for new users');
```

**D4 — app/api/auth/admin-setup/route.ts:29-48**
Remove `adminCount` from response. Return only `isSetupAvailable: boolean`.

**D5 — lib/schemas.ts**
Apply `ChangePasswordSchema` strength rules to user creation:
```typescript
password: z.string().min(12).regex(/[A-Z]/).regex(/[a-z]/).regex(/[0-9]/)
```

### Missing Tests / Migrations

- Test that bootstrap is blocked without secret in all non-production environments.
- Test that admin bootstrap does not auto-login (or forces password change).
- Test that user creation without password fails or generates secure random password.

---

## 6. Data & Model Flows

### Current Behavior

- **Prisma Schema** (`prisma/schema.prisma`): 13 models with proper relations and indexes. `User` has `failedLoginAttempts`, `lockedUntil`, `tokenVersion`, `twoFactorEnabled`, `twoFactorSecret`. `Transaction` has `idempotencyKey`, `rawPayload`. `Subscription` has renewal locking fields.
- **CSV Import** (`lib/csv-import.ts`): 2MB file cap, 2000-row cap. Validates required columns, date/time formats, booking code consistency.
- **User Export** (`app/api/admin/users/export/route.ts`): Exports `id, name, email, phone, country, createdAt` as CSV.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| E1 | **P1** | `app/api/admin/users/export/route.ts` — CSV export uses naive string concatenation: `"${u.name.replace(/"/g, '""')}"` but doesn't escape commas, newlines, or other CSV-special chars in `name`. Could produce malformed or injectable CSV. |
| E2 | **P1** | `prisma/schema.prisma` — `User.twoFactorSecret` is `String?` with no length constraint. If legacy data exists as plaintext, it would be stored as-is. |
| E3 | **P2** | No soft-delete pattern. Deleted users lose all data permanently. Audit trail exists but no recovery. |
| E4 | **P2** | `Transaction.rawPayload` is `Json?` with no size limit. Could grow unbounded. |

### Recommended Changes

**E1 — app/api/admin/users/export/route.ts**
Use a proper CSV serializer or at minimum escape fields correctly:
```typescript
const escapeCsv = (val: string) => `"${val.replace(/"/g, '""').replace(/\n/g, ' ').replace(/\r/g, '')}"`;
const rows = users.map((u) => `${u.id},${escapeCsv(u.name)},${u.email},${escapeCsv(u.phone ?? '')},${u.country},${new Date(u.createdAt).toISOString()}`);
```

**E2 — prisma/schema.prisma + migration**
- Add a `twoFactorSecretVersion` field or prefix encrypted secrets with `v1:` consistently.
- Run a migration to encrypt any existing plaintext `twoFactorSecret` values.

**E3 — Consider soft-delete**
- Add `deletedAt` to `User` and filter soft-deleted users from queries.
- Or export deleted users to cold storage before deletion.

**E4 — prisma/schema.prisma**
Add a check constraint or application-level size limit on `rawPayload` (e.g., max 64KB).

### Missing Tests / Migrations

- Test CSV export escaping of special characters (commas, quotes, newlines).
- Migration to encrypt existing plaintext `twoFactorSecret` values.

---

## 7. Frontend / Client Flows

### Current Behavior

- **SPA Navigation** (`app/login/page.tsx`, `app/payments/callback/page.tsx`): Client-side forms with `fetch` to API routes. Uses `apiFetch` wrapper that auto-refreshes access tokens on 401.
- **Safe Redirect** (`lib/safe-redirect.ts`): Rejects absolute URLs and `//` protocol-relative paths.
- **API Client** (`lib/api-client.ts`): `apiFetch` retries once on 401 after refresh.
- **Dashboard Context** (`lib/dashboard-user-context.tsx`): Fetches `/api/me` once per layout mount.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| F1 | **P1** | No `Content-Security-Policy` header. Without CSP, XSS attacks can exfiltrate cookies, tokens, and data. |
| F2 | **P1** | No `X-XSS-Protection` header (legacy but provides defense-in-depth for older browsers). |
| F3 | **P2** | Client-side role checks in `app/login/page.tsx:41-43` redirect based on `data.role` from API response. If client is compromised or MITM, attacker could manipulate response. Server-side middleware enforces role, but client shouldn't blindly trust. |
| F4 | **P2** | `app/payments/callback/page.tsx:28` — Polls `/api/payments/status?reference=...` with user-supplied `reference` from URL query param. If an attacker crafts a URL with someone else's reference, the endpoint will return 404 (because it checks `tx.userId === user.sub`), but the reference is still exposed in server logs/browser history. |
| F5 | **P2** | No `Secure` flag enforcement check. Cookies use `secure: true` hardcoded, which is correct for HTTPS but breaks local HTTP development. |

### Recommended Changes

**F1 — next.config.js**
```javascript
async headers() {
  return [{
    source: '/(.*)',
    headers: [
      { key: 'Content-Security-Policy', value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://api.paystack.co https://api.flutterwave.com https://open.er-api.com https://cdn.jsdelivr.net npm:; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none';" },
      // ... existing headers
    ]
  }];
}
```
Tighten `script-src` and `style-src` after confirming no inline scripts/styles are required. Remove `'unsafe-inline'` and `'unsafe-eval'` if possible.

**F2 — next.config.js**
```javascript
{ key: 'X-XSS-Protection', value: '1; mode=block' },
```

**F3 — app/login/page.tsx**
Keep server-side enforcement as primary. Client-side redirect is UX only. Ensure server middleware and API routes are the only authorization boundary.

**F4 — app/payments/callback/page.tsx**
No direct fix needed (server validates ownership), but consider not logging raw references or using POST body instead of GET query params for sensitive identifiers.

**F5 — lib/auth.ts**
```typescript
export function cookieOptions(maxAgeSeconds: number) {
  const isDev = process.env.NODE_ENV !== 'production';
  return {
    httpOnly: true,
    secure: !isDev,
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeSeconds,
  };
}
```

### Missing Tests / Migrations

- Test CSP header presence and policy.
- Test that `secure` cookie flag is `false` in development.
- Test XSS payload rejection via CSP.

---

## 8. Infrastructure & Deployment Flows

### Current Behavior

- **Vercel Config** (`vercel.json`): Cron jobs at 2 AM (renew) and 3 AM (cleanup). Injects `Authorization: Bearer $CRON_SECRET`.
- **Health** (`app/api/health/route.ts`): Public endpoint, checks DB connectivity with `SELECT 1`.
- **Next Config** (`next.config.js`): Security headers set globally. `output: 'standalone'`. Sharp marked external.
- **Environment** (`.env.example`): Documents all required vars.

### Identified Vulnerabilities

| # | Severity | Finding |
|---|----------|---------|
| G1 | **P1** | `app/api/health/route.ts` — Public endpoint returns detailed DB error messages (`'Database connectivity check failed'`) and timestamp. Could aid reconnaissance. |
| G2 | **P2** | No rate limiting on `/api/health`. Could be abused for DoS or DB connection exhaustion. |
| G3 | **P2** | `vercel.json` cron schedules are hardcoded. No visibility into cron job history or failure alerting. |
| G4 | **P2** | No `robots.txt` or `sitemap.xml` configuration documented. |
| G5 | **P2** | `next.config.js` `output: 'standalone'` is good, but no `generateBuildId` or immutable build caching configured. |

### Recommended Changes

**G1 — app/api/health/route.ts**
```typescript
return NextResponse.json(
  {
    status: 'error',
    timestamp: new Date().toISOString(),
    checks: { database: { status: 'error' } }
    // Remove detailed error message
  },
  { status: 500 }
);
```

**G2 — app/api/health/route.ts**
```typescript
import { checkRateLimit, publicLimiter, getClientIp } from '@/lib/ratelimit';
// ...
const ip = getClientIp(req);
if (!(await checkRateLimit(publicLimiter, ip))) {
  return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
}
```

**G3 — Add cron monitoring**
- Log cron execution results to a dedicated table or monitoring service.
- Set up Vercel Cron failure alerts.
- Add a dead-man's switch or heartbeat endpoint.

**G4 — Add public/robots.txt**
```typescript
// app/robots.ts
export const robots = [{ userAgent: '*', allow: '/', disallow: '/api/' }];
```

**G5 — next.config.js**
```javascript
generateBuildId: async () => {
  return process.env.BUILD_ID || 'development';
},
```

### Missing Tests / Migrations

- Test health endpoint rate limiting.
- Test health endpoint doesn't leak internal details on failure.

---

## 9. Prioritized Remediation Plan (P0/P1/P2)

### P0 — Critical (Fix Immediately)

| ID | Flow | Finding | File | Fix |
|----|------|---------|------|-----|
| A1 | Auth | JWT secret silently falls back to hardcoded dev secret | `lib/auth.ts:18-21` | Throw when env var missing/undersized; remove hardcoded fallback |

### P1 — High (Fix Within 1 Sprint)

| ID | Flow | Finding | File | Fix |
|----|------|---------|------|-----|
| B1 | Authz | No CSRF protection on state-changing endpoints | All POST/PATCH/DELETE routes | Add CSRF token validation middleware |
| B2 | Authz | `/api/me/payments` exposes rawPayload | `app/api/me/payments/route.ts` | Redact rawPayload before returning |
| B3 | Authz | Admin user detail exposes unredacted transactions | `app/api/admin/users/[id]/route.ts` | Redact rawPayload in transactions |
| C1 | Payments | User payment history exposes rawPayload | `app/api/me/payments/route.ts` | Same as B2 |
| D1 | Admin | Bootstrap allowed without secret in preview/staging | `app/api/auth/admin-setup/route.ts` | Require explicit env opt-in |
| D2 | Admin | Bootstrap auto-logs in without password change | `app/api/auth/admin-setup/route.ts` | Force password change before session |
| D3 | Admin | Hardcoded weak default password | `app/api/admin/users/route.ts:154` | Reject empty password or generate random |
| F1 | Frontend | Missing CSP header | `next.config.js` | Add Content-Security-Policy |
| A2 | Auth | No refresh token rotation | `app/api/auth/refresh/route.ts` + `lib/auth.ts` | Implement rotation with token family tracking |
| A3 | Auth | 2FA login-verify rate limited only by IP | `app/api/auth/2fa/login-verify/route.ts` | Add user ID to rate limit key |

### P2 — Medium (Fix Within 2 Sprints)

| ID | Flow | Finding | File | Fix |
|----|------|---------|------|-----|
| B4 | Authz | No concurrent session limits | `lib/sessions.ts` + login route | Enforce max 5 active sessions per user |
| E1 | Data | CSV export injection risk | `app/api/admin/users/export/route.ts` | Properly escape CSV fields |
| E2 | Data | Legacy twoFactorSecret may be plaintext | `prisma/schema.prisma` + migration | Encrypt existing secrets |
| F2 | Frontend | Missing X-XSS-Protection header | `next.config.js` | Add legacy XSS header |
| G1 | Infra | Health endpoint leaks error details | `app/api/health/route.ts` | Generic error response |
| G2 | Infra | Health endpoint not rate-limited | `app/api/health/route.ts` | Add public rate limit |
| A4 | Auth | No email verification | Registration flow | Add email verification tokens |
| A5 | Auth | Weak password policy on reset | `lib/schemas.ts` | Enforce 12+ chars + complexity |
| C3 | Payments | No Cache-Control on payment data | `app/api/payments/status/route.ts` | Add `private, no-store` |
| D4 | Admin | Bootstrap GET leaks adminCount | `app/api/auth/admin-setup/route.ts` | Remove adminCount from response |
| E3 | Data | No soft-delete for users | Prisma schema | Add `deletedAt` field |
| E4 | Data | Unbounded rawPayload size | `prisma/schema.prisma` | Add size limit or check constraint |
| G3 | Infra | No cron monitoring/alerting | Vercel config | Add monitoring + alerts |

---

## 10. Security Measures Checklist

### Implemented ✅

- [x] bcryptjs password hashing (cost 12) with rehashing on login
- [x] JWT access tokens (15m TTL) + refresh tokens (7d TTL) with `tokenVersion`
- [x] Account lockout: 5 failed attempts → 30 min lock
- [x] Timing-safe secret comparison (`crypto.timingSafeEqual`)
- [x] Dual fail-closed rate limiting (IP + normalized identifier) for auth/payment/admin
- [x] Fail-open for public endpoints when Redis is down
- [x] AES-256-GCM encryption for payment auth codes and TOTP secrets
- [x] Atomic payment webhook processing with idempotency
- [x] Admin bootstrap with secret + atomic transaction + audit logging
- [x] Password reset with token hashing, TTL, session revocation, audit logging
- [x] 2FA (TOTP) with challenge tokens, rate limiting, audit logging
- [x] Server-side entitlement checks with teaser mode
- [x] Media sanitization (magic bytes, decompression bomb, EXIF stripping, watermarking)
- [x] CSRF origin check on image upload
- [x] Audit logging on all admin mutations (`writeAudit` non-fatal)
- [x] Safe redirect validation (`safeRedirectPath`)
- [x] Security headers: HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy
- [x] Renewal cron with atomic locking, idempotency, stale lock recovery
- [x] Cleanup cron for old password reset tokens and stale sessions
- [x] Public health check endpoint
- [x] No raw SQL, no `dangerouslySetInnerHTML`

### Missing / Needs Remediation ❌

- [ ] JWT secret validation throws on missing/undersized (currently falls back to hardcoded dev secret)
- [ ] Content-Security-Policy header
- [ ] CSRF tokens on all state-changing endpoints
- [ ] Refresh token rotation
- [ ] Redact `rawPayload` in `/api/me/payments` and admin user detail
- [ ] Concurrent session limits per user
- [ ] Email verification on registration
- [ ] Stronger password policy (12+ chars, complexity, breach check)
- [ ] Rate limit on password reset confirm
- [ ] Proper CSV export escaping
- [ ] Health endpoint generic error response + rate limiting
- [ ] Soft-delete pattern for user data
- [ ] `X-XSS-Protection` header
- [ ] `Cache-Control: private, no-store` on sensitive payment APIs
- [ ] Encrypt legacy `twoFactorSecret` values
- [ ] Remove `adminCount` from admin bootstrap GET
- [ ] Force password change after admin bootstrap
- [ ] Reject empty passwords on user creation (no hardcoded default)
- [ ] Allow admin bootstrap without secret only via explicit env var
- [ ] Webhook async processing for high-load resilience

---

## Appendix: File Path Reference

| File | Purpose |
|------|---------|
| `lib/auth.ts` | JWT issue/verify, cookie options |
| `lib/password.ts` | bcrypt hashing/verification |
| `lib/ratelimit.ts` | Redis-based rate limiting with fail-open/closed |
| `lib/rbac.ts` | `requireUser`, `requireAdmin`, `optionalUser` |
| `lib/entitlement.ts` | Server-side paywall enforcement |
| `lib/payments.ts` | Payment initialization, webhook handling, renewal logic |
| `lib/encryption.ts` | AES-256-GCM encryption for tokens/secrets |
| `lib/media.ts` | Image upload, sanitization, S3 storage, watermarking |
| `lib/sessions.ts` | Device fingerprinting, session tracking, anomaly detection |
| `lib/audit.ts` | Non-fatal audit logging with redaction |
| `lib/safe-redirect.ts` | Open redirect prevention |
| `middleware.ts` | UX guard for route protection |
| `prisma/schema.prisma` | Database schema |
| `next.config.js` | Security headers, build config |
| `vercel.json` | Cron schedules |
| `app/api/auth/*` | Authentication endpoints |
| `app/api/payments/*` | Payment initialization and webhooks |
| `app/api/admin/*` | Admin CRUD endpoints |
| `app/api/predictions/*` | Public prediction feed with entitlement |
| `app/api/media/*` | Media serving with entitlement checks |
