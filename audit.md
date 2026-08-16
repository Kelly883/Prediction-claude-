# PredictPro — Flow-by-Flow Audit Report

**Project:** PredictPro (Next.js 15 App Router, Vercel serverless)
**Audit method:** Flow-by-Flow (flow-by-flow skill v2.0.1)
**Date:** 2026-08-16
**Auditor:** Kilo
**Branch:** session/agent_63beb93b-509e-4837-bfba-3fc8b81b168d

---

## 1. Identified Flows

| # | Flow | Actor | Goal |
|---|---|---|---|
| F1 | Public marketing + auth | Visitor / User | Browse marketing, register, log in, reset password |
| F2 | 2FA challenge | User with 2FA | Complete second-factor login |
| F3 | Password reset | User / Visitor | Recover account access via email |
| F4 | User dashboard | Authenticated user | Manage profile, subscription, predictions, security |
| F5 | Prediction feed + detail | Authenticated user | View predictions respecting paywall |
| F6 | Payment checkout | Authenticated user | Purchase a plan via Paystack/Flutterwave |
| F7 | Payment callback + status | Authenticated user | Confirm payment result after provider redirect |
| F8 | Webhook intake | Payment provider | Deliver charge success/failure events |
| F9 | Auto-renewal cron | System (Vercel Cron) | Charge stored payment methods for due subscriptions |
| F10 | Cleanup cron | System (Vercel Cron) | Purge old password reset tokens and stale sessions |
| F11 | Admin dashboard | Admin | Manage plans, predictions, users, transactions, CMS, access rules |
| F12 | Media upload + serving | Admin / Viewer | Upload prediction images, view with watermark/entitlement |
| F13 | CSV import wizard | Admin | Bulk-create predictions from CSV |

---

## 2. Flow Contracts

### F1 — Public Marketing + Auth

**Actor:** Visitor (unauthenticated) or returning user
**Goal:** Register, log in, or reset password
**Entry points:** `/`, `/pricing`, `/register`, `/login`, `/forgot-password`
**Trigger:** Navigation, CTA click, form submit
**Exit:** Redirect to `/dashboard` (user) or `/admin` (admin) on success; error state on failure

**UI surfaces:**
- Landing page (`app/page.tsx`)
- Pricing (`app/pricing/page.tsx`)
- Register (`app/register/page.tsx`)
- Login (`app/login/page.tsx`)
- Forgot password (`app/forgot-password/page.tsx`)

**Frontend/backend behavior:**
- `POST /api/auth/register` validates via `RegisterSchema`, hashes password with bcryptjs cost 12, creates user with `role: 'user'`, dual rate-limits by IP + normalized email.
- `POST /api/auth/login` validates via `LoginSchema`, verifies password, issues access + refresh tokens, touches session, logs anomaly/admin audit events, returns 2FA challenge if enabled. Implements account lockout after 5 failed attempts (30 min).
- `POST /api/auth/logout` deletes cookies client-side.
- `POST /api/auth/refresh` exchanges refresh token for new access token, enforces `tokenVersion` (password reset revocation).
- Middleware redirects logged-in users away from auth pages to their respective home.

**States covered:**
- Success: tokens issued, cookies set, redirect.
- Failure (invalid credentials): generic 401, audit log written, no user enumeration.
- Failure (email taken): 409 on register.
- Failure (rate limit): 429.
- Validation failure: 400 with ZodError formatting.
- Account locked: 403.
- Interruption: N/A (short flows).

**Dependencies:** Prisma, bcryptjs, jose, Redis (rate limiting), Resend (password reset email).
**Regression impact:** Low for marketing pages; auth changes affect all downstream flows.
**Tests:** `tests/auth.test.ts` (token roundtrips, 2FA challenge distinction, password hashing). `tests/security.test.ts` (timing-safe, safe redirect). `tests/account-lockout.test.ts` (3 tests).
**Runtime proof:** `npm run build` succeeds; `npm test` → 160/160 passing.
**Unresolved risk:** 
- `lib/auth.ts:18-21` — `requireSecret` silently falls back to hardcoded dev secret when env var is missing/undersized.
- No email verification flow implemented despite schema model existing.

**Verdict: FAIL (P0 secret fallback; P2 missing email verification)**

---

### F2 — 2FA Challenge

**Actor:** User with `twoFactorEnabled = true`
**Goal:** Complete login after password verification
**Entry point:** `/api/auth/2fa/login-verify` (POST)
**Trigger:** Login response returns `requiresTwoFactor: true` with `challengeToken`
**Exit:** Real session cookies issued on valid TOTP; 400/401 on invalid/expired

**UI surfaces:**
- Login page (`app/login/page.tsx`) — shows 2FA code input when challenge returned.

**Frontend/backend behavior:**
- Challenge token is short-lived (5m), signed with access secret, type `two_factor_challenge`.
- `verifyTwoFactorChallengeToken` enforces type claim.
- `verifyTotpCode` validates 6-digit TOTP against `user.twoFactorSecret`.
- Rate-limited by IP on the verify endpoint.
- Audit logs 2FA failures and admin logins via 2FA.

**States covered:**
- Success: access + refresh tokens + cookies.
- Failure (invalid code): 400, audit logged.
- Failure (expired challenge): 401.
- Failure (rate limit): 429.

**Dependencies:** otplib, jose, Redis.
**Regression impact:** Medium — breaks login for 2FA users.
**Tests:** `tests/auth.test.ts` covers token type distinction; `tests/totp-encryption.test.ts` covers TOTP/encryption.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** Rate limiting only by IP, not by user ID — distributed attackers can rotate IPs to bypass.

**Verdict: FAIL (P1 missing user-level rate limit on 2FA verify)**

---

### F3 — Password Reset

**Actor:** User who forgot password
**Goal:** Reset password via email link
**Entry point:** `/forgot-password` (POST to `/api/auth/password-reset/request`), `/reset-password` (POST to `/api/auth/password-reset/confirm`)
**Trigger:** Form submit on forgot-password page
**Exit:** Redirect to login on success; generic message always returned

**Frontend/backend behavior:**
- Request route: accepts email, dual rate-limited (IP + email), creates `PasswordResetToken` with SHA-256 hash of random 32-byte token, 30min TTL. Sends email via Resend. Always returns same generic response to prevent account enumeration.
- Confirm route: rate-limited by IP, hashes received token, looks up `PasswordResetToken`, validates expiry and `usedAt` null, hashes new password, updates user, sets `usedAt` on token, increments `tokenVersion` (revokes all existing sessions). Atomic transaction.

**States covered:**
- Success: password updated, token marked used, sessions revoked.
- Failure (invalid/expired token): generic error.
- Failure (rate limit): 429.
- Validation: min 8 chars only, no complexity enforcement.

**Dependencies:** Prisma, crypto, Resend.
**Regression impact:** Medium — affects user account access.
**Tests:** `tests/password-reset-revocation.test.ts`, `tests/password-strength.test.ts` (6 tests).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** 
- Password policy only enforces min 8 chars, no uppercase/lowercase/number requirements.
- No real email delivery tested against Resend.

**Verdict: PASS (with P2 gap: weak password policy on reset)**

---

### F4 — User Dashboard

**Actor:** Authenticated user (non-admin)
**Goal:** Manage profile, subscription, payments, security
**Entry points:** `/dashboard`, `/dashboard/profile`, `/dashboard/plans`, `/dashboard/security`, `/dashboard/predictions/[id]`
**Trigger:** Navigation, form submit, subscription action
**Exit:** Page renders data or redirects on auth failure

**UI surfaces:**
- Dashboard home (`app/dashboard/page.tsx`)
- Plans (`app/dashboard/plans/page.tsx`)
- Profile (`app/dashboard/profile/page.tsx`)
- Security (`app/dashboard/security/page.tsx`)
- Prediction detail (`app/dashboard/predictions/[id]/page.tsx`)

**Frontend/backend behavior:**
- `PATCH /api/me` updates `name` and `phone` only, scoped to authenticated user.
- `GET /api/me/subscription` returns active subscription, strips `renewalAuthCode`.
- `GET /api/me/payments` returns user's payment history. **Does NOT redact `rawPayload`** — exposes payment provider secrets.
- `POST /api/payments/cancel-auto-renew` sets `autoRenew: false`, strips sensitive fields.
- `PATCH /api/me/password` requires current password, hashes new password, increments `tokenVersion`, deletes all sessions. Audit logged.
- Middleware redirects non-users away from `/dashboard`.

**States covered:**
- Success: data returned, mutations applied.
- Failure (unauthorized): 401 from `requireUser`.
- Failure (not found): 404.
- Validation: Zod schemas enforce shape.

**Dependencies:** Prisma, auth helpers.
**Regression impact:** Medium — affects all logged-in users.
**Tests:** Indirectly covered via auth, entitlement, and payment tests.
**Runtime proof:** Clean build.
**Unresolved risk:** `/api/me/payments` exposes raw `rawPayload` with payment provider tokens/auth codes.

**Verdict: FAIL (P1 rawPayload exposed in user payment history)**

---

### F5 — Prediction Feed + Detail

**Actor:** Authenticated user
**Goal:** View predictions, respecting subscription/entitlement
**Entry points:** `/dashboard` (feed), `/dashboard/predictions/[id]` (detail), `/api/predictions`, `/api/predictions/[id]`
**Trigger:** Navigation, API fetch
**Exit:** Full post or teaser returned; 401/403 on auth failure

**Frontend/backend behavior:**
- `GET /api/predictions` returns all published posts. For each post, calls `canView(userId, post)`. If entitled, returns full post; otherwise returns `toTeaser()` (strips `bookingCode`, `bodyNotes`, `items`, marks `locked: true`).
- `GET /api/predictions/[id]` returns single post with same entitlement check.
- `canView` priority: admin bypass → complimentary access → active free rule (promo_window or global_trial based on user signup date) → post.freeUntil → active subscription covering category.

**States covered:**
- Success (entitled): full post with items.
- Success (not entitled): teaser only.
- Failure (not logged in): 401.
- Failure (post not found): 404.

**Dependencies:** Prisma, entitlement engine.
**Regression impact:** High — core product value.
**Tests:** `tests/entitlement.test.ts` — 15 tests covering all entitlement branches.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

**Verdict: PASS**

---

### F6 — Payment Checkout

**Actor:** Authenticated user
**Goal:** Purchase a plan
**Entry point:** `/dashboard/plans` → `POST /api/payments/initialize`
**Trigger:** Plan selection, "Subscribe" click
**Exit:** Redirect to provider checkout URL; callback page polls status

**Frontend/backend behavior:**
- Validates `InitializePaymentSchema` (planId UUID, optional provider enum).
- Rate-limited by IP + user ID, fail-closed.
- Resolves price: NGN direct for Nigerian users; USD via FX conversion for others, with optional markup and `priceUSDOverride`.
- Generates idempotency key (`crypto.randomUUID()`), reference `pp_<uuid>`.
- Calls provider-specific initialize endpoint, stores `Transaction` with `status: 'pending'`.
- Returns `transactionId`, `amount`, `currency`, `checkoutUrl`.

**States covered:**
- Success: checkout URL returned.
- Failure (validation): 400.
- Failure (rate limit): 429.
- Failure (provider error): propagated as 500.

**Dependencies:** Prisma, Paystack/Flutterwave SDKs, FX rate provider, Redis.
**Regression impact:** High — revenue path.
**Tests:** `tests/payments.test.ts` — 4 tests for price resolution and minor-unit conversion.
**Runtime proof:** Clean build.
**Unresolved risk:** 
- No `Cache-Control: private, no-store` headers on payment endpoints.
- No live charge ever made (documented in README).

**Verdict: PASS (with P2 gap: missing Cache-Control headers)**

---

### F7 — Payment Callback + Status

**Actor:** Authenticated user
**Goal:** Confirm payment result after provider redirect
**Entry point:** `/payments/callback` (page), `GET /api/payments/status?reference=...`
**Trigger:** Provider redirect after checkout
**Exit:** Shows success/failure; redirects to dashboard or retry

**Frontend/backend behavior:**
- Callback page polls `/api/payments/status` because webhook delivery isn't instant.
- `GET /api/payments/status` requires auth, checks `reference` param, looks up transaction by `providerReference`, verifies `tx.userId === user.sub` (prevents cross-user reference lookup), returns status/amount/currency.

**States covered:**
- Success: status returned.
- Failure (not found / not owner): 404.
- Failure (missing reference): 400.

**Dependencies:** Prisma, auth.
**Regression impact:** Medium — user experience on payment completion.
**Tests:** `tests/payment-status.test.ts` (4 tests).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** No `Cache-Control` headers on status endpoint.

**Verdict: PASS (with P2 gap: missing Cache-Control headers)**

---

### F8 — Webhook Intake

**Actor:** Payment provider (Paystack / Flutterwave)
**Goal:** Deliver charge event; activate/renew subscription
**Entry points:** `/api/payments/webhook/paystack` (POST), `/api/payments/webhook/flutterwave` (POST)
**Trigger:** Provider sends webhook
**Exit:** 200 with result; subscription activated/renewed or transaction marked failed

**Frontend/backend behavior:**
- Paystack: reads `req.text()` first (raw bytes), verifies HMAC-SHA512 signature with `timingSafeStringEqual`, parses JSON, filters `charge.success`, extracts reusable authorization.
- Flutterwave: verifies `verif-hash` with `timingSafeStringEqual`, reads raw body, filters `charge.completed`, independently verifies transaction via provider API (`flutterwaveVerifyTransaction`), extracts reusable token.
- Both call `handleVerifiedWebhook` which:
  - Looks up transaction by `providerReference`.
  - Idempotency: returns immediately if status is terminal (`success`, `failed`, `cancelled`).
  - Validates amount, currency, customer email match.
  - Atomically transitions `pending/processing` → new status via `updateMany`.
  - On success: calls `activateOrRenewSubscription` (creates or extends subscription, stores encrypted renewal token, resets retry counter).
  - Stores raw payload.

**States covered:**
- Success: subscription activated/renewed.
- Failure (signature mismatch): 400.
- Failure (verification mismatch): transaction marked failed.
- Failure (amount/currency/email mismatch): transaction marked failed.
- Idempotent replay: no-op.
- Concurrent delivery: atomic `updateMany` prevents double-activation.

**Dependencies:** Prisma, crypto, provider SDKs, encryption lib.
**Regression impact:** Critical — revenue and subscription state.
**Tests:** `tests/webhook-idempotency.test.ts` (5 tests), `tests/paystack-webhook.test.ts`, `tests/flutterwave-webhook.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** Webhook handlers do DB work synchronously before responding — providers recommend acknowledging fast. Under high load, could timeout.

**Verdict: PASS (with noted gap: synchronous webhook processing may bottleneck under load)**

---

### F9 — Auto-Renewal Cron

**Actor:** Vercel Cron (system)
**Goal:** Charge due subscriptions automatically
**Entry point:** `/api/cron/renew` (GET, secured by `CRON_SECRET`)
**Trigger:** Daily at 02:00 UTC (Vercel Cron)
**Exit:** JSON summary of renewed/retried/expired/reminders

**Frontend/backend behavior:**
- Verifies `Authorization: Bearer $CRON_SECRET` with `timingSafeStringEqual`.
- Queries subscriptions due within 24h (`endAt <= cutoff`) that are `active`, `autoRenew: true`, and in `idle`, `failed`, or stale `processing` state.
- For each due subscription:
  - Skips if `plan` or `user` relation missing (logs error).
  - If no `renewalAuthCode`/`renewalProvider`:
    - If already expired: marks `expired`.
    - Else: sends reminder email (deduped by `renewalReminderSentAt`), leaves subscription active.
  - If payment method exists:
    - Atomically claims renewal lock via `updateMany`.
    - Idempotency: checks if successful transaction already exists for deterministic reference.
    - Decrypts auth code, calls provider charge endpoint.
    - On success: creates transaction, extends subscription atomically via `$transaction`.
    - On failure: increments `renewalAttempts`. If `>= MAX_RENEWAL_ATTEMPTS` (3), marks `expired` and `autoRenew: false`. Otherwise keeps `active` with `renewalStatus: 'failed'` for next run.

**States covered:**
- Renewed: subscription extended, counters reset.
- Retry scheduled: attempts incremented, stays active.
- Expired: after max attempts.
- Reminder sent: for no-payment-method-on-file.
- Stuck lock recovered: after `RENEWAL_LOCK_TIMEOUT_SECONDS`.
- Error: logged in JSON response, doesn't crash batch.

**Dependencies:** Prisma, provider charge APIs, email (Resend), encryption.
**Regression impact:** Critical — subscription continuity.
**Tests:** `tests/renewal-locking.test.ts` (3 tests: atomic claim, stuck lock recovery, active lock block).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** No real charge has ever been made. Reminder email depends on Resend config. No cron execution logging (schema model `CronExecutionLog` exists but no route implements it).

**Verdict: PASS (with noted gaps: no live charge test, no cron execution logging)**

---

### F10 — Cleanup Cron

**Actor:** Vercel Cron (system)
**Goal:** Purge old password reset tokens and stale user sessions
**Entry point:** `/api/cron/cleanup` (GET, secured by `CRON_SECRET`)
**Trigger:** Daily at 03:00 UTC (Vercel Cron)
**Exit:** JSON summary of deleted tokens and sessions

**Frontend/backend behavior:**
- Verifies `Authorization: Bearer $CRON_SECRET` with `timingSafeStringEqual`.
- Deletes `PasswordResetToken` records where `expiresAt < now` or `usedAt` is set and older than 24h.
- Deletes `UserSession` records where `lastSeenAt` older than 90 days.
- Errors are caught per-section and returned in `results.errors` without crashing the batch.

**States covered:**
- Success: counts returned.
- Partial failure: one section fails, other still runs.
- Total failure: DB unavailable, returns 500.

**Dependencies:** Prisma.
**Regression impact:** Low — maintenance task.
**Tests:** `tests/cleanup-cron.test.ts` (3 tests).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** None.

**Verdict: PASS**

---

### F11 — Admin Dashboard

**Actor:** Admin
**Goal:** Manage all product data and view system health
**Entry points:** `/admin`, `/admin/users`, `/admin/plans`, `/admin/predictions`, `/admin/transactions`, `/admin/audit-logs`, `/admin/cms`, `/admin/free-access`
**Trigger:** Navigation, form submit, CSV upload, publish action
**Exit:** Data rendered, mutations applied, redirects on auth failure

**UI surfaces:**
- Admin overview (`app/admin/page.tsx`)
- Users (`app/admin/users/page.tsx`, `/admin/users/[id]`)
- Plans (`app/admin/plans/page.tsx`)
- Predictions (`app/admin/predictions/page.tsx`, `/admin/predictions/[id]`, `/admin/predictions/csv`)
- Transactions (`app/admin/transactions/page.tsx`)
- Audit logs (`app/admin/audit-logs/page.tsx`)
- CMS (`app/admin/cms/page.tsx`)
- Free access (`app/admin/free-access/page.tsx`)

**Frontend/backend behavior:**
- All admin API routes call `requireAdmin(req)`.
- Key routes and protections:
  - `GET /api/admin/users` — explicit `SAFE_USER_FIELDS` select (no `passwordHash`, `twoFactorSecret`).
  - `POST /api/admin/users` — creates user, defaults password to `PredictPro@2026` if not provided, returns safe fields.
  - `GET /api/admin/transactions` — redacts `rawPayload` via `redactPayload`.
  - `GET /api/admin/plans` / `POST` / `PATCH /:id` — CRUD with schemas.
  - `POST /api/admin/predictions` — creates with items, validates schema, audits.
  - `PATCH /api/admin/predictions/[id]` — updates, audits.
  - `POST /api/admin/predictions/[id]/publish` — sets status to `published`.
  - `POST /api/admin/predictions/[id]/images` — upload with CSRF origin check, rate limit, quota (max 10), magic byte validation, sanitization, audit.
  - `POST /api/admin/predictions/csv/preview` + `/confirm` — CSV import with row-level validation, 2MB/2000-row caps.
  - `POST /api/admin/free-access-rules` — creates global trial or promo window rules.
  - `POST /api/admin/complimentary-access` — grants user or post-specific access.
  - `GET /api/admin/cms/[page]` / `PATCH` — CMS section editor.
  - `GET /api/admin/audit-logs` — returns audit trail.

**States covered:**
- Success: mutations applied, audit logged.
- Failure (unauthorized): 403.
- Failure (validation): 400.
- Failure (not found): 404.
- CSV validation errors: returned per-row in preview.

**Dependencies:** Prisma, csv-import, media, email.
**Regression impact:** High — admin controls all content and access.
**Tests:** `tests/admin-setup.test.ts`, `tests/admin-predictions.test.ts`, `tests/csv-import.test.ts`, `tests/admin-audit-enforcement.test.ts` (21 tests).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:**
- No CSRF tokens on state-changing endpoints (only image upload checks `origin`).
- Hardcoded default password `PredictPro@2026`.
- Admin bootstrap auto-logs in without forcing password change.
- Bootstrap GET leaks `adminCount`.
- `/api/admin/users/[id]` returns transactions without redacting `rawPayload`.

**Verdict: FAIL (Multiple P1 findings: CSRF, rawPayload, bootstrap behavior, default password)**

---

### F12 — Media Upload + Serving

**Actor:** Admin (upload), Viewer (serve)
**Goal:** Upload prediction images securely; view with watermark and entitlement check
**Entry points:** `POST /api/admin/predictions/[id]/images`, `GET /api/media/[id]/signed-url`, `GET /api/media/[id]/raw`
**Trigger:** Upload form, image link click
**Exit:** Upload success/failure; signed URL or raw buffer served

**Frontend/backend behavior:**
- Upload (`uploadMedia`):
  - Verifies post exists.
  - Reads file buffer, calls `sanitizeAndValidateImage`:
    - Size check (5MB max).
    - MIME type allowlist (JPEG/PNG).
    - Magic byte validation (binary signature).
    - Sharp decompression bomb prevention (`limitInputPixels: 50MP`).
    - Dimension limits (10,000px max).
    - Metadata stripping, re-encoding, downscaling to 1920x1080.
    - Compression loop if buffer still >5MB.
    - SHA-256 hash calculation.
  - Generates random filename (`crypto.randomUUID()`), stores in S3 or local.
  - Atomically creates `MediaAsset` DB record; removes file if DB write fails.
- Serving (`getSignedUrlForViewer`):
  - Checks `canView(userId, post)` entitlement.
  - If S3 configured: returns presigned URL.
  - If watermark enabled: builds watermarked copy with user's email embedded in SVG overlay, stores in `scratch/`, returns presigned URL for watermarked version.
- Raw proxy (`getMediaBuffer`): serves buffer directly for local dev.

**States covered:**
- Success: asset created, URL returned.
- Failure (not found): 404.
- Failure (entitlement): 403.
- Failure (invalid image): 400 with specific reason.
- Failure (quota exceeded): 400.

**Dependencies:** Sharp, AWS S3 SDK, Prisma, entitlement.
**Regression impact:** Medium — affects image display and storage costs.
**Tests:** `tests/image-upload-security.test.ts`, `tests/image-upload-api.test.ts`.
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** Watermarked copies accumulate in S3 `scratch/` with no cleanup (potential storage leak).

**Verdict: PASS (with noted gap: no cleanup for watermarked scratch copies)**

---

### F13 — CSV Import Wizard

**Actor:** Admin
**Goal:** Bulk-create predictions from CSV
**Entry points:** `/admin/predictions/csv` (page), `POST /api/admin/predictions/csv/preview`, `POST /api/admin/predictions/csv/confirm`
**Trigger:** CSV upload, preview review, confirm submit
**Exit:** Preview with row-level errors; confirmed creation of posts + items

**Frontend/backend behavior:**
- Preview validates CSV structure, row count (max 2000), file size (max 2MB), parses rows, returns per-row validation errors.
- Confirm validates full `CsvConfirmSchema`, creates `PredictionPost` with `items` in a single transaction.
- Rate-limited by admin limiter.

**States covered:**
- Success: preview returns parsed rows; confirm creates posts.
- Failure (validation): 400 with row-level errors.
- Failure (rate limit): 429.
- Failure (file too large): 400.

**Dependencies:** csv-import lib, Prisma.
**Regression impact:** Medium — bulk data creation.
**Tests:** `tests/csv-import.test.ts` (5 tests).
**Runtime proof:** Clean build, tests pass.
**Unresolved risk:** 
- CSV export (`app/api/admin/users/export/route.ts`) uses naive string escaping — commas, newlines, and carriage returns in `name` or `phone` fields can produce malformed CSV.

**Verdict: PASS (with P2 gap: CSV export injection risk)**

---

## 3. Security Audit Summary

| Finding | Severity | Status |
|---|---|---|
| JWT secrets fail-loud on missing/undersized values | P0 | **FAIL** — `lib/auth.ts:18-21` falls back to hardcoded dev secret |
| Timing-safe string comparison for secrets | Medium | **PASS** — `lib/timing-safe.ts` used consistently |
| Sharp/postcss vulnerabilities | High | **Documented** — README explains why not exploitable; `next/image` unused, postcss only processes authored CSS |
| Media upload validation + filename sanitization | Medium | **PASS** — magic bytes, size/MIME limits, random filename |
| Register server-side validation | Medium | **PASS** — `RegisterSchema`/`LoginSchema` |
| Public GET rate limiting | Low-Medium | **PASS** — `publicLimiter` on `/api/plans` and `/api/cms/[page]` |
| Open redirect via `?next=` | Medium | **PASS** — `lib/safe-redirect.ts` rejects absolute/protocol-relative URLs |
| Admin user list data leak (`passwordHash`, `twoFactorSecret`) | High | **PASS** — explicit `SAFE_USER_FIELDS` select |
| CSV upload resource exhaustion | Low | **PASS** — 2MB file cap, 2000-row cap |
| `activateOrRenewSubscription` type safety | High (structural) | **PASS** — retyped to `Prisma.TransactionClient` |
| `Transaction.planId` missing from schema | High (bug) | **PASS** — added with proper migration |
| Dynamic route conflict | High (production-only) | **PASS** — renamed to `[id]`; added `scripts/check-route-conflicts.mjs` |
| Redis/rate-limit crash on register | High (production bug) | **PASS** — fail-open for public, fail-closed with 503 for auth/payment/admin |
| Login/register redirect to homepage | Medium (UX bug) | **PASS** — defaults to `/dashboard` |
| Dashboard sidebar invisible on mobile | Medium (UX bug) | **PASS** — contained background/padding |
| No CSRF protection on state-changing endpoints | P1 | **FAIL** — only image upload checks `origin` |
| `/api/me/payments` exposes rawPayload | P1 | **FAIL** — no redaction |
| `/api/admin/users/[id]` exposes rawPayload | P1 | **FAIL** — no redaction in transactions |
| Admin bootstrap allowed without secret in preview/staging | P1 | **FAIL** — `NODE_ENV !== 'production'` bypass |
| Admin bootstrap auto-logs in without password change | P1 | **FAIL** — issues session immediately |
| Hardcoded default password `PredictPro@2026` | P1 | **FAIL** — publicly visible in source |
| Missing CSP header | P1 | **FAIL** — no Content-Security-Policy |
| No refresh token rotation | P1 | **FAIL** — same refresh token reusable indefinitely |
| 2FA login-verify rate limited only by IP | P1 | **FAIL** — no user-level rate limit |
| Email verification schema exists but no route | P2 | **FAIL** — `EmailVerificationToken` model in schema but no API flow |
| No concurrent session limits | P2 | **FAIL** — `lib/sessions.ts` tracks but never enforces max |
| CSV export injection risk | P2 | **FAIL** — commas/newlines not escaped |
| Health endpoint leaks error details | P2 | **FAIL** — returns `'Database connectivity check failed'` |
| Health endpoint not rate-limited | P2 | **FAIL** — no rate limit on `/api/health` |
| Missing X-XSS-Protection header | P2 | **FAIL** — not set in `next.config.js` |
| No Cache-Control on payment data | P2 | **FAIL** — payment/status endpoints lack `private, no-store` |
| Weak password policy (min 8 chars only) | P2 | **FAIL** — no complexity requirements |
| npm audit: postcss + sharp high CVEs | High | **Documented** — transitive via `next`; fix requires `next@16` |

---

## 4. Gate Results

| Gate | Result | Evidence |
|---|---|---|
| **Foundation structure** | PASS | `prisma/schema.prisma` present, migrations directory exists, 68 routes in `next build` |
| **Foundation execution** | UNVERIFIED | No real Postgres/Redis/Paystack/Flutterwave/Resend instance available in this sandbox to run bootstrap, migrations, or live-authorization proof |
| **Build evidence** | PASS | `npm test` → 160/160 passing; `npm run build` → succeeds |
| **Build-state truth** | PASS | Evidence generated from actual repo state, not hand-edited narrative |
| **Installation check** | UNVERIFIED | Skill references (`references/orchestration.md`, `references/audit.md`) not present in installed skill bundle |

---

## 5. Test Coverage Summary

| Category | Test File(s) | Count |
|---|---|---|
| Auth tokens + 2FA challenge | `auth.test.ts` | 6 |
| Password hashing | `auth.test.ts` | 1 |
| Account lockout | `account-lockout.test.ts` | 3 |
| Entitlement (paywall rules) | `entitlement.test.ts` | 15 |
| Price/currency resolution | `payments.test.ts` | 4 |
| Payment status | `payment-status.test.ts` | 4 |
| Payment reference uniqueness | `payment-reference-uniqueness.test.ts` | (present) |
| Webhook idempotency + concurrency | `webhook-idempotency.test.ts` | 5 |
| Paystack webhook | `paystack-webhook.test.ts` | (present) |
| Flutterwave webhook | `flutterwave-webhook.test.ts` | (present) |
| Renewal locking + concurrency | `renewal-locking.test.ts` | 3 |
| CSV validation | `csv-import.test.ts` | 5 |
| Security (timing-safe, redirect) | `security.test.ts` | 9 |
| Resilience (fail-open rate limit, FX) | `resilience.test.ts` | 4 |
| Password reset revocation | `password-reset-revocation.test.ts` | (present) |
| Admin setup | `admin-setup.test.ts` | (present) |
| Admin predictions | `admin-predictions.test.ts` | (present) |
| Image upload security | `image-upload-security.test.ts` | (present) |
| Image upload API | `image-upload-api.test.ts` | (present) |
| TOTP + encryption | `totp-encryption.test.ts` | (present) |
| Encryption | `encryption.test.ts` | (present) |
| Password strength | `password-strength.test.ts` | 6 |
| Admin audit enforcement | `admin-audit-enforcement.test.ts` | 21 |
| Health check | `health.test.ts` | 2 |
| Cleanup cron | `cleanup-cron.test.ts` | 3 |

**Total: 26 test files, 160 tests — all passing.**

---

## 6. Prioritized Remediation Plan

### P0 — Critical (Fix Immediately)

| ID | Flow | Finding | File | Solution |
|---|---|---|---|---|
| A1 | Auth | JWT secret silently falls back to hardcoded dev secret | `lib/auth.ts:18-21` | Throw when env var missing/undersized; remove hardcoded fallback |

### P1 — High (Fix Within 1 Sprint)

| ID | Flow | Finding | File | Solution |
|---|---|---|---|---|
| B1 | Authz | No CSRF protection on state-changing endpoints | All POST/PATCH/DELETE routes | Add CSRF token validation middleware |
| B2 | User dashboard | `/api/me/payments` exposes rawPayload | `app/api/me/payments/route.ts` | Redact rawPayload before returning, reuse `redactPayload` from `lib/payments.ts` |
| B3 | Admin dashboard | `/api/admin/users/[id]` exposes rawPayload in transactions | `app/api/admin/users/[id]/route.ts` | Redact rawPayload in transactions |
| D1 | Admin | Bootstrap allowed without secret in preview/staging | `app/api/auth/admin-setup/route.ts` | Require explicit env opt-in (`ALLOW_ADMIN_BOOTSTRAP_WITHOUT_SECRET`) |
| D2 | Admin | Bootstrap auto-logs in without password change | `app/api/auth/admin-setup/route.ts` | Force password change before issuing session |
| D3 | Admin | Hardcoded weak default password | `app/api/admin/users/route.ts:154` | Reject empty password or generate secure random |
| F1 | Frontend | Missing CSP header | `next.config.js` | Add Content-Security-Policy |
| A2 | Auth | No refresh token rotation | `app/api/auth/refresh/route.ts` + `lib/auth.ts` | Implement rotation with token family tracking |
| A3 | Auth | 2FA login-verify rate limited only by IP | `app/api/auth/2fa/login-verify/route.ts` | Add user ID to rate limit key |

### P2 — Medium (Fix Within 2 Sprints)

| ID | Flow | Finding | File | Solution |
|---|---|---|---|---|
| A4 | Auth | No email verification flow | Schema + missing route | Implement `POST /api/auth/verify-email` and enforce before login |
| A5 | Auth | Weak password policy on reset | `lib/schemas.ts` | Enforce 12+ chars + complexity |
| B4 | Authz | No concurrent session limits | `lib/sessions.ts` + login route | Enforce max 5 active sessions per user |
| C3 | Payments | No Cache-Control on payment data | `app/api/payments/status/route.ts`, `/api/me/payments/route.ts` | Add `private, no-store` |
| E1 | Data | CSV export injection risk | `app/api/admin/users/export/route.ts` | Properly escape CSV fields |
| F2 | Frontend | Missing X-XSS-Protection header | `next.config.js` | Add legacy XSS header |
| G1 | Infra | Health endpoint leaks error details | `app/api/health/route.ts` | Generic error response |
| G2 | Infra | Health endpoint not rate-limited | `app/api/health/route.ts` | Add public rate limit |

---

## 7. Conclusion

The PredictPro codebase demonstrates mature flow design with strong security hygiene, atomic state transitions, comprehensive error handling, and extensive test coverage. All identified flows have been implemented with success/failure/validation/retry states.

**Critical finding:** `lib/auth.ts:18-21` silently falls back to a hardcoded development JWT secret when `JWT_ACCESS_SECRET` or `JWT_REFRESH_SECRET` is missing or undersized. This enables JWT forgery in production and must be fixed before any production deployment.

**High-impact gaps:** Missing CSRF protection, unredacted `rawPayload` in user payment history and admin user detail, admin bootstrap misconfiguration, missing CSP header, and no refresh token rotation.

**Overall assessment: FAIL — production-ready only after P0 and P1 remediations are applied.**
