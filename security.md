# PredictPro — Security Reference

**Audience:** developers, operators, reviewers
**Method:** flow-by-flow security contract audit
**Date:** 2026-08-16
**Source of truth:** `README.md` (Sections 9–22), `AUDIT_REPORT.md`, inline code comments

---

## 1. Security Flows

| Flow | Actor | Security Goal |
|---|---|---|
| F1 Auth | Visitor / User | Register, login, logout, refresh, password reset without enumeration or forgery |
| F2 2FA | 2FA-enabled user | Second-factor challenge/verify without token replay |
| F3 Payments | User / Provider | Checkout, callback, webhook, status lookup without tampering or leakage |
| F4 Renewal | System (Cron) | Auto-charge subscriptions atomically without double-spend |
| F5 Entitlement | User / Admin | Paywall enforcement without client-trust |
| F6 Admin | Admin | CRUD with audit, no sensitive data leakage, no CSRF |
| F7 Media | Admin / Viewer | Upload sanitization, watermarking, entitlement-gated serving |
| F8 Resilience | System | Fail-open for non-security dependencies; fail-closed for auth/payment/admin |
| F9 Health | System | Liveness check without auth |
| F10 Cleanup | System | Purge old password reset tokens and stale user sessions |

---

## 2. Flow Security Contracts

### F1 — Auth

**Entry:** `/register`, `/login`, `/forgot-password`, `/reset-password`
**Exit:** Tokens + cookies or generic error

**Security controls:**
- `lib/auth.ts`: JWT secrets throw at module load if missing or < 32 chars (`requireSecret`). Access token TTL 15m, refresh TTL 7d. Refresh carries `tokenVersion`; password reset increments version, revoking prior sessions.
- `lib/password.ts`: bcryptjs (pure JS, Node-only, split from Edge-safe `lib/auth.ts`). Login rehashes passwords if stored with a lower cost factor (`PASSWORD_REHASH_COST = 12`).
- `lib/timing-safe.ts`: `crypto.timingSafeEqual` for all secret comparisons (signatures, cron token).
- `lib/ratelimit.ts`: dual rate-limit (IP + normalized email) on register, login, password-reset request, 2FA verify. Fail-closed (503) for auth policy; fail-open for public policy.
- `lib/safe-redirect.ts`: `?next=` rejects absolute URLs and `//host` protocol-relative paths.
- `middleware.ts`: UX guard only — redirects non-admins from `/admin`, non-users from `/dashboard`, logged-in users from auth pages. **Not the security boundary.**
- Account lockout (`app/api/auth/login/route.ts`): after `MAX_FAILED_LOGIN_ATTEMPTS` (5) consecutive failures, account is locked for `LOCKOUT_DURATION_MINUTES` (30). Locked accounts return 403 even with correct password. Successful login resets counter and lock. Admins can unlock via `PATCH /api/admin/users/[id]` (`{ action: 'unlock' }`).
- Register: `RegisterSchema` enforces min 8-char password, valid email, required name/phone/country. Creates `role: 'user'` only.
- Login: generic 401 on failure; no user enumeration. Writes `auth.login_failure` audit. Increments `failedLoginAttempts` per user.
- Password reset: `PasswordResetToken` stores SHA-256 hash of random 32-byte token, 30min TTL. Always returns same generic response. `tokenVersion` incremented on confirm, revoking all sessions.
- Cookies: `httpOnly`, `secure`, `sameSite: 'lax'`, path `/`.
- Security headers (`next.config.js`): `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.

**States:**
- Success: tokens issued, cookies set, session touched.
- Failure (invalid creds): 401, audit logged, failed attempts incremented.
- Failure (account locked): 403.
- Failure (email taken): 409.
- Failure (rate limit): 429.
- Failure (validation): 400.
- Interruption/retry: rate-limited.

**Dependencies:** Prisma, bcryptjs, jose, Redis, Resend.
**Tests:** `tests/auth.test.ts`, `tests/security.test.ts`, `tests/password-reset-revocation.test.ts`, `tests/account-lockout.test.ts`.
**Runtime proof:** `tsc --noEmit` clean; `next build` succeeds; 153/153 tests pass.
**Unresolved risk:** No real Resend delivery test in CI.

---

### F2 — 2FA

**Entry:** `/api/auth/2fa/login-verify`
**Exit:** Session cookies or 400/401

**Security controls:**
- Challenge token: 5m TTL, type `two_factor_challenge`, signed with access secret. Cannot be replayed as access or refresh token (type claim enforced).
- `lib/twofactor.ts`: TOTP via otplib. `verifyTotpCode` validates 6-digit code against `twoFactorSecret`.
- Rate-limit on verify endpoint (fail-closed).
- Audit: `auth.2fa_failed` on invalid code; `auth.admin_login` with `via: '2fa'` metadata.

**States:**
- Success: tokens + cookies.
- Failure (invalid code): 400, audit.
- Failure (expired challenge): 401.
- Failure (rate limit): 429.

**Dependencies:** otplib, jose, Redis.
**Tests:** `tests/auth.test.ts` (token type distinction), `tests/totp-encryption.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

### F3 — Payments

**Entry:** `/api/payments/initialize`, `/payments/callback`, `/api/payments/status`, `/api/payments/cancel-auto-renew`
**Exit:** Checkout URL, status JSON, or updated subscription

**Security controls:**
- `lib/payments.ts`:
  - `initializePayment`: requires auth, rate-limited (fail-closed) by IP + user ID. Resolves price server-side. Generates `idempotencyKey` (`crypto.randomUUID()`), reference `pp_<uuid>`. Stores `Transaction` with `status: 'pending'`.
  - `handleVerifiedWebhook`: idempotent — returns immediately if status is terminal (`success`, `failed`, `cancelled`). Validates amount (2-decimal match), currency, and customer email against DB record. Atomic transition via `updateMany` (`pending/processing` → new status). On success, calls `activateOrRenewSubscription` in `$transaction`.
  - `activateOrRenewSubscription`: typed `Prisma.TransactionClient` (not `any`). Guards `tx.planId` null-safety. Encrypts renewal auth code via `lib/encryption.ts` (AES-256-GCM). Resets retry counter on success.
  - `cancelAutoRenew`: scoped to authenticated user, strips `renewalAuthCode` from response.
  - `verifyPaystackSignature`: HMAC-SHA512 over raw body, timing-safe compare.
  - `verifyFlutterwaveSignature`: timing-safe compare of `verif-hash` header.
- Webhook routes (`app/api/payments/webhook/*`):
  - Read `req.text()` **before** JSON parse to preserve raw bytes for signature verification.
  - Paystack: filters `charge.success`, extracts reusable authorization.
  - Flutterwave: independent API verification (`flutterwaveVerifyTransaction`) before processing.
- `lib/fx.ts`: fail-open — cache miss fetches live; cache write failure returns rate anyway. Static fallback rates for NGN/USD.

**States:**
- Success: checkout URL, subscription activated/renewed.
- Failure (validation): 400.
- Failure (rate limit): 429.
- Failure (signature): 400.
- Failure (amount/currency/email mismatch): transaction marked `failed`.
- Failure (provider decline): retry scheduled (cron) or 500 on initialize.
- Cancellation: `autoRenew: false`, access persists until `endAt`.

**Dependencies:** Prisma, Paystack/Flutterwave, crypto, encryption, FX provider, Redis.
**Tests:** `tests/payments.test.ts`, `tests/webhook-idempotency.test.ts`, `tests/paystack-webhook.test.ts`, `tests/flutterwave-webhook.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** No live charge against real provider. Webhook handlers synchronous — may timeout under high load (README Section 7).

---

### F4 — Renewal Cron

**Entry:** `/api/cron/renew` (GET, `Authorization: Bearer $CRON_SECRET`)
**Exit:** JSON summary

**Security controls:**
- `CRON_SECRET` verified with `timingSafeStringEqual`.
- Atomic renewal locking: `updateMany` claims lock; concurrent workers see `count === 0` and skip.
- Stale lock recovery: leases expire after `RENEWAL_LOCK_TIMEOUT_SECONDS` (default 15m).
- Deterministic reference: `renew_<subId>_<periodEpoch>_att<nextAttempt>` prevents divergent charge requests.
- Idempotency: checks existing successful transaction for reference before charging.
- No-payment-method path: sends reminder email (deduped by `renewalReminderSentAt`), only expires after `endAt` passes.
- Retry policy: stays `active` with `renewalAttempts` incremented; only marks `expired` after `MAX_RENEWAL_ATTEMPTS` (3).

**States:**
- Renewed: counters reset, subscription extended.
- Retry: attempts incremented, stays active.
- Expired: after max attempts.
- Reminder: email sent for missing payment method.
- Stuck lock: recovered after timeout.

**Dependencies:** Prisma, provider charge APIs, Resend, encryption.
**Tests:** `tests/renewal-locking.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** No real charge tested. Reminder email depends on Resend config.

---

### F5 — Entitlement

**Entry:** `/api/predictions`, `/api/predictions/[id]`, `/api/media/[id]/signed-url`
**Exit:** Full post or teaser; 403 for media

**Security controls:**
- `lib/entitlement.ts`: server-side only. Priority: admin bypass → complimentary access → active free rule (`promo_window` or `global_trial` based on user signup date) → `post.freeUntil` → active subscription covering category.
- `toTeaser()` strips `bookingCode`, `bodyNotes`, `items`; marks `locked: true`.
- Media serving (`lib/media.ts`): `getSignedUrlForViewer` calls `canView` before issuing presigned URL or watermarked copy.
- Client never decides visibility.

**States:**
- Entitled: full content.
- Not entitled: teaser (predictions) or 403 (media).
- Admin: always allowed.

**Dependencies:** Prisma.
**Tests:** `tests/entitlement.test.ts` (15 cases).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

### F6 — Admin

**Entry:** `/admin/*`, `/api/admin/*`
**Exit:** Data, mutation, or 403/404

**Security controls:**
- Every API route calls `requireAdmin(req)` (`lib/rbac.ts`).
- `middleware.ts` redirects non-admins before render (UX only; not the boundary).
- `SAFE_USER_FIELDS` select on user list/detail — excludes `passwordHash` and `twoFactorSecret`. Grep confirmed no other leak (15 call sites audited).
- Admin transactions list redacts sensitive keys from `rawPayload` (authorization codes, tokens, etc.) before returning to admin UI.
- Account lockout: admins can unlock locked accounts via `PATCH /api/admin/users/[id]` with `{ action: 'unlock' }`. Audit logged as `auth.account_unlocked`.
- CSV import: 2MB file cap, 2000-row cap.
- Image upload: CSRF origin check (`req.headers.get('origin')` vs `host`), rate-limit, magic-byte validation, sanitization, 5MB cap, max 10 images per post.
- Audit: `writeAudit()` on every mutation (enforced by `tests/admin-audit-enforcement.test.ts` — static analysis asserts every admin route with Prisma mutations imports and calls `writeAudit`).
- No raw SQL (`$queryRaw` unused). No `dangerouslySetInnerHTML`.

**States:**
- Success: mutation applied, audit logged.
- Failure (unauthorized): 403.
- Failure (validation): 400.
- Failure (not found): 404.
- CSV: per-row errors in preview.

**Dependencies:** Prisma, csv-import, media, email.
**Tests:** `tests/admin-setup.test.ts`, `tests/admin-predictions.test.ts`, `tests/csv-import.test.ts`, `tests/admin-audit-enforcement.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

### F7 — Media

**Entry:** `POST /api/admin/predictions/[id]/images`, `GET /api/media/[id]/signed-url`, `GET /api/media/[id]/raw`
**Exit:** Asset record or image bytes

**Security controls:**
- Upload (`lib/media.ts`):
  - Magic-byte validation (JPEG/PNG only).
  - Size cap 5MB, dimension cap 10,000px, decompression bomb limit 50MP.
  - Sharp re-encoding strips EXIF/GPS/metadata.
  - Random filename (`crypto.randomUUID()`), no user input in key.
  - Atomic DB create + S3 delete on failure.
- Serving:
  - `canView` entitlement check before any URL or buffer.
  - Watermark: SVG overlay with user email, escaped via `escapeXml`.
- Raw proxy: local dev only when S3 not configured.

**States:**
- Success: asset created / served.
- Failure (invalid image): 400.
- Failure (entitlement): 403.
- Failure (quota): 400.

**Dependencies:** Sharp, AWS S3 SDK, Prisma, entitlement.
**Tests:** `tests/image-upload-security.test.ts`, `tests/image-upload-api.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** Watermarked scratch copies accumulate in S3 with no cleanup.

---

### F8 — Resilience

**Entry:** Any route depending on Redis or external FX
**Exit:** Request proceeds or fails open

**Security controls:**
- `lib/ratelimit.ts`: `checkRateLimit` catches Redis errors. Fail-closed (503) for AUTH/PAYMENT/ADMIN policies; fail-open (allow) for PUBLIC.
- `lib/fx.ts`: cache read failure → live fetch; cache write failure → log warning, return rate. Static fallback rates for NGN/USD.

**States:**
- Redis up: rate limiting active.
- Redis down: auth/payment/admin return 503; public browsing continues.

**Dependencies:** Redis, external FX APIs.
**Tests:** `tests/resilience.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

### F9 — Health

**Entry:** `/api/health`
**Exit:** JSON with status and database latency

**Security controls:**
- Public endpoint (no auth required).
- Executes a lightweight `SELECT 1` against Postgres to verify connectivity.
- Returns `200 OK` with `{ status: 'ok', checks: { database: { status: 'ok', latencyMs: <ms> } } }` on success.
- Returns `500` with `{ status: 'error' }` on database failure.

**States:**
- Success: 200 with latency.
- Failure: 500.

**Dependencies:** Prisma.
**Tests:** `tests/health.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

### F10 — Cleanup

**Entry:** `/api/cron/cleanup` (GET, `Authorization: Bearer $CRON_SECRET`)
**Exit:** JSON summary of deleted records

**Security controls:**
- `CRON_SECRET` verified with `timingSafeStringEqual`.
- Deletes `PasswordResetToken` rows where `expiresAt < now` or `usedAt` is older than 24 hours.
- Deletes `UserSession` rows where `lastSeenAt` older than 90 days.
- Errors are caught per-step and returned in the JSON response without crashing the batch.

**States:**
- Success: counts of deleted records returned.
- Partial failure: errors array populated, successful deletions still counted.
- Failure (unauthorized): 401.

**Dependencies:** Prisma.
**Tests:** `tests/cleanup-cron.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

---

## 3. Security Audit Findings (Historical + Current)

### Fixed (from README Section 11, 13, 17, 19)

| # | Finding | Severity | Fix |
|---|---|---|---|
| 1 | JWT secrets silently fallback to empty string | High | `requireSecret` throws at module load if missing/undersized |
| 2 | Plain `===` on secrets (timing attack) | Medium | `crypto.timingSafeEqual` via `lib/timing-safe.ts` |
| 3 | Sharp/postcss known vulnerabilities | High | Documented as non-exploitable; `next/image` unused, postcss processes authored CSS only |
| 4 | Media upload: no size/type validation, raw filename in S3 key | Medium | 8MB→5MB cap, MIME allowlist, magic bytes, random filename |
| 5 | `/api/auth/register` zero server-side validation | Medium | `RegisterSchema`/`LoginSchema` |
| 6 | Public `GET /api/plans` and `/api/cms/[page]` no rate limit | Low-Medium | Both rate-limited by IP |
| 7 | `?next=` open redirect | Medium | `lib/safe-redirect.ts` rejects absolute/protocol-relative URLs |
| 8 | `GET /api/admin/users` returned `passwordHash` + `twoFactorSecret` | High | Explicit `SAFE_USER_FIELDS` select; grep confirmed only occurrence |
| 9 | CSV upload no file-size/row-count cap | Low | 2MB file cap, 2000-row cap |
| 10 | `activateOrRenewSubscription` typed `db: any` | High | Retyped `Prisma.TransactionClient`; fixed null-safety gaps |
| 11 | `Transaction.planId` missing from schema | High | Added with proper migration |
| 12 | Dynamic route conflict `[id]` vs `[postId]` | High | Renamed to `[id]`; added `scripts/check-route-conflicts.mjs` |
| 13 | Redis crash on `/register` (500 on every attempt) | High | Fail-open for public; fail-closed 503 for auth/payment/admin |
| 14 | Login/register redirected to homepage | Medium | `safeRedirectPath` fallback param; both default to `/dashboard` |
| 15 | Dashboard sidebar invisible on mobile | Medium | Contained background/padding for mobile nav strip |
| 16 | Admin transactions leak sensitive webhook payload fields | Medium | `redactPayload` strips authorization codes, tokens, secrets from `rawPayload` before response |
| 17 | No account lockout after failed logins | Medium | `failedLoginAttempts` + `lockedUntil` added to User; 5 attempts → 30min lock; admin unlock via `PATCH /api/admin/users/[id]` |
| 18 | No password rehashing on login | Low | Login detects bcrypt cost factor < 12 and rehashes transparently |
| 19 | No security headers (HSTS, X-Frame-Options, etc.) | Medium | `next.config.js` adds X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS |
| 20 | No public health check endpoint | Low | `GET /api/health` verifies DB connectivity without auth |
| 21 | No cleanup of old password reset tokens / sessions | Low | `GET /api/cron/cleanup` purges tokens >24h old and sessions >90d old |

### Residual / Accepted

| # | Finding | Severity | Status |
|---|---|---|---|
| R1 | `x-forwarded-for` trusted for rate-limit keys | Low | Accepted on Vercel edge; would use `req.ip` on other hosts |
| R2 | No real Resend delivery test | Low | Documented; code path correct, dev-mode fallback exists |
| R3 | No live Paystack/Flutterwave charge test | Low | Documented; sandbox-only |
| R4 | No structural `writeAudit` enforcement | Medium | **Fixed** — `tests/admin-audit-enforcement.test.ts` asserts every admin mutation route calls `writeAudit`; missing call added to `app/api/admin/users/route.ts` POST |
| R5 | Synchronous webhook DB work | Medium | Acceptable at MVP scale; recommend queue at load |
| R6 | Watermarked scratch copies accumulate | Low | No TTL cleanup; recommend S3 lifecycle rule |
| R7 | `postcss`/`sharp` advisories in dependency tree | High | Documented non-exploitable; upgrade `next@16` when feasible |

---

## 4. Gate Results

| Gate | Result | Evidence |
|---|---|---|
| Foundation structure | PASS | `prisma/schema.prisma`, migrations/, 68 routes built |
| Foundation execution | UNVERIFIED | No live Postgres/Redis/Paystack/Flutterwave/Resend in sandbox |
| Build evidence | PASS | `vitest` 153/153; `tsc --noEmit` clean; `next build` succeeds; route-conflict check clean |
| Build-state truth | PASS | Evidence from actual repo state |
| Installation check | UNVERIFIED | Single skill bundle provided |

---

## 5. Verification Commands

```bash
# Static
npx tsc --noEmit

# Tests
npx vitest run

# Build
npx next build

# Route conflicts
node scripts/check-route-conflicts.mjs

# Admin audit enforcement
npx vitest run tests/admin-audit-enforcement.test.ts

# Dependencies
npm audit
```

---

## 6. Operational Security Notes

- **JWT secrets:** Generate with `openssl rand -base64 32`. Set in Vercel env + GitHub Actions secrets. Missing values fail build.
- **CRON_SECRET:** Any random string. Vercel injects `Authorization: Bearer $CRON_SECRET`.
- **Database:** `DATABASE_URL` must be pooled (Neon `-pooler` or Supabase port 6543). `DIRECT_URL` unpooled for migrations.
- **Redis:** Upstash REST-based. Fail-open for public endpoints, fail-closed 503 for auth/payment/admin.
- **Media:** S3 or local `storage/`. Watermarked copies go to `scratch/` — monitor storage.
- **Admin bootstrap:** No seed admin. Run `npm run make-admin -- you@example.com` after registering a user.
- **Audit logs:** Written non-fatally via `writeAudit()`. Review `app/api/admin/audit-logs` for anomalies.
- **Account lockout:** 5 failed logins → 30min lock. Admins unlock via `PATCH /api/admin/users/[id]` with `{ action: 'unlock' }`. Audit logged.
- **Password rehashing:** Login transparently upgrades bcrypt cost to 12 if lower.
- **Security headers:** HSTS, X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy set in `next.config.js`.
- **Health check:** `/api/health` verifies DB connectivity without auth — useful for load balancers and uptime monitors.
- **Cleanup cron:** `/api/cron/cleanup` runs daily at 03:00 UTC, purging old password reset tokens (>24h) and stale sessions (>90d).

---

## 7. Incident Response Checklist

1. **Compromised user account:** Increment `tokenVersion` via password reset or admin tool. This revokes all existing sessions.
2. **Stolen refresh token:** Short TTL (7d) + `tokenVersion` check limits window. Rotate `JWT_REFRESH_SECRET` to invalidate all refresh tokens.
3. **Webhook replay attack:** Atomic `updateMany` + terminal-status idempotency prevents double-activation.
4. **Payment dispute:** `Transaction.rawPayload` and `AuditLog.metadata` provide evidence chain. `providerReference` is unique and user-scoped on status queries.
5. **Renewal stuck:** `RENEWAL_LOCK_TIMEOUT_SECONDS` (default 15m) auto-recovers stuck `processing` leases.
6. **Rate-limit bypass (Redis down):** Auth/payment/admin return 503; public continues. Monitor Redis health.
