# PredictPro — Vercel Deployment

Next.js (App Router) rewrite of the backend, built specifically to run as Vercel serverless functions. See the bottom of this file for what changed from the earlier NestJS scaffold and why.

## 1) Required external services

| Service | Used for | Suggested provider |
|---|---|---|
| Postgres | Primary database | **Neon** or **Supabase** (both give pooled + direct connection strings) |
| Redis (REST) | FX rate cache, rate limiting | **Upstash** (has a free tier, REST-based — no persistent connection) |
| Object storage | Prediction images | **Cloudflare R2** (S3-compatible, no egress fees) or AWS S3 |
| Payments | Subscriptions | Paystack + Flutterwave (as per PRD) |

## 2) Environment variables

Two **separate** places need these, and missing either one blocks a different part of the pipeline — this tripped up an actual deploy, so being explicit about it:

1. **GitHub repo secrets** (Settings → Secrets and variables → Actions → New repository secret) — used only by `.github/workflows/ci.yml`'s `migrate` job. Needs `DATABASE_URL` and `DIRECT_URL`. If your Postgres provider doesn't have a separate pooled/direct distinction, set both secrets to the same connection string — Prisma just needs `DIRECT_URL` non-empty, it doesn't have to be different from `DATABASE_URL`. Without this, `npx prisma migrate deploy` fails with `P1012: You must provide a nonempty direct URL`.
2. **Vercel Project Settings → Environment Variables** — used by the actual running app. Copy every key from `.env.example`, for `Production` at minimum (`Preview`/`Development` too if you want those environments to work — ideally against separate DB/Redis instances). Do this **before your first deploy attempt**, not after: `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET` specifically are checked at module load (Section 11's fail-fast guard), which Next.js's build-time "Collecting page data" step triggers by importing the route modules — so a missing secret fails the *build*, not just requests at runtime, on every route that touches auth (nearly all of them). This is intentional: better to fail loudly at build time than deploy with a forgeable empty signing key. Generate real values with `openssl rand -base64 32` (or any 32+ char random string) for both JWT secrets and `CRON_SECRET`.

Other keys that are easy to miss:
- `DATABASE_URL` must be the **pooled** connection string (Neon: the one with `-pooler` in the hostname; Supabase: port 6543). `DIRECT_URL` is the unpooled one.
- `CRON_SECRET` — any random string. Vercel automatically sends `Authorization: Bearer $CRON_SECRET` on requests it makes to your cron path, and `app/api/cron/renew` checks that header. No extra Vercel-side config needed beyond setting the env var.

## 3) Database migrations

Prisma migrations don't run automatically on Vercel deploys — run them yourself against `DIRECT_URL` before or during your deploy pipeline:

```bash
npx prisma migrate deploy
```

Recommended: add this as a step in your CI (GitHub Actions) before the Vercel deploy, or run it manually before promoting a deploy to production. Do **not** run `prisma migrate dev` against production.

## 3a) Getting admin access

There's no seeded admin account and no self-registration path to admin — `/api/auth/register` always creates `role: 'user'`, on purpose. To create your first admin:

1. Register a normal account through the app (`/register`).
2. Run `npm run make-admin -- you@example.com` locally, with `DATABASE_URL` pointed at your real database (e.g. `DATABASE_URL="<your connection string>" npm run make-admin -- you@example.com`, or `vercel env pull .env.local` first so it's picked up automatically).
3. Log out and back in — the JWT issued at login carries the role, so an already-issued session won't pick up the change until you re-authenticate.

`scripts/promote-admin.mjs` is a thin, one-off CLI — it's meant to be run by whoever operates the deployment, not exposed as an in-app feature.

## 4) Deploying

```bash
vercel link
vercel env pull .env.local   # sanity-check env vars match
npx prisma migrate deploy
vercel --prod
```

The cron job in `vercel.json` (`/api/cron/renew`, daily at 02:00 UTC) is picked up automatically on deploy — no separate configuration in the Vercel dashboard needed. Note: Vercel's Hobby plan limits cron jobs to once/day, which is exactly what this needs; Pro plans allow finer schedules if you later want more frequent renewal sweeps.

## 5) Runtime notes specific to Vercel

- **`export const runtime = 'nodejs'`** is set on every route that touches Prisma, bcryptjs, or sharp — these don't work on the Edge runtime. Don't remove it.
- **sharp** (image watermarking) requires the Node runtime and installs its native binary during Vercel's build step automatically — no extra config needed as long as `runtime = 'nodejs'` stays set.
- **Prisma connection pooling**: `lib/prisma.ts` caches the client on `globalThis` to survive warm invocations, but each cold start still opens a new pooled connection. This is why the pooled `DATABASE_URL` (via Neon/Supabase's built-in pooler, not a raw Postgres connection) is mandatory — without it you'll hit "too many connections" under real traffic within minutes.
- **Webhook raw body**: both `payments/webhook/*` routes call `req.text()` before any JSON parsing, because Paystack's HMAC signature is computed over the exact raw bytes. Don't refactor these to use `req.json()` first.

## 6) What changed from the NestJS scaffold (and why)

| NestJS piece | Why it doesn't fit Vercel | Replacement here |
|---|---|---|
| `@nestjs/schedule` `@Cron` | No persistent process to host a scheduler | Vercel Cron (`vercel.json`) → hits `/api/cron/renew`, secured by `CRON_SECRET` |
| `AuditInterceptor` (auto-logs `@Audit()` routes via DI) | No framework-level request interceptor in plain Route Handlers | `writeAudit()` in `lib/audit.ts`, called explicitly at the end of each admin mutation route |
| `JwtAuthGuard` / `RolesGuard` (DI-based guards) | Same reason | `requireUser()` / `requireAdmin()` helper functions called at the top of each route |
| `ioredis` (persistent TCP) | Serverless functions shouldn't hold long-lived connections | `@upstash/redis` (REST-based) |
| `@nestjs/throttler` | Needs the same persistent-process assumption for its in-memory store | `@upstash/ratelimit` (Redis-backed, works across cold starts) |
| `bcrypt` (native binding) | Extra native compile step; `jsonwebtoken` isn't Edge-safe either | `bcryptjs` (pure JS) + `jose` (works in both Node and Edge runtimes) |

**One real gap to flag:** the audit logging is no longer automatically enforced. In the NestJS version, forgetting `@Audit(...)` on a route was a lint-able/obvious omission wired through DI; here, forgetting to call `writeAudit(...)` at the end of an admin route just... silently doesn't log anything. All the admin routes in this scaffold call it, but there's no structural guarantee a future route will. A reasonable follow-up: a small test that asserts every `app/api/admin/**/route.ts` file contains a `writeAudit(` call, or centralizing all admin mutations through one wrapper function instead of relying on each route remembering.

## 7) Payments: how the provider integration actually works

Both gaps flagged in the previous pass are now wired up for real (`lib/providers/paystack.ts`, `lib/providers/flutterwave.ts`):

- **Checkout.** `initializePayment()` calls the provider's initialize endpoint directly (`/transaction/initialize` for Paystack, `/v3/payments` for Flutterwave) and returns a real `checkoutUrl` to redirect the user to. We generate our own reference up front (`pp_<uuid>`) and hand it to the provider — both providers echo it back in their webhook payload, so there's no "placeholder reference, rewrite it later" step.
- **Auto-renewal.** When a webhook confirms a successful charge, `extractReusableAuthorization()` / `extractReusableToken()` pull the reusable payment-method identifier out of the payload (Paystack: `authorization_code` when `reusable: true`; Flutterwave: `card.token`) and store it on the `Subscription` row (`renewalProvider`, `renewalAuthCode`). The cron job then charges that directly via `/transaction/charge_authorization` or `/v3/tokenized-charges` — no checkout UI, no user interaction.
- **Retry policy.** Implemented as attempt-counting on the `Subscription` itself (`renewalAttempts`, `lastRenewalError`) rather than a separate table, since the access-control decision (`active` vs `expired`) lives on that row anyway. A failed charge does **not** immediately revoke access — the subscription stays `active` with `renewalAttempts` incremented, and the same daily cron run picks it up again next time since `endAt` hasn't moved. Only after `MAX_RENEWAL_ATTEMPTS` (3) consecutive failures does it flip to `expired` and `autoRenew: false`.

**Known gaps still worth closing before real money moves through this:**
- If the original charge didn't yield a reusable authorization (e.g. certain card types, or a customer who paid via bank transfer), the subscription has nothing to auto-charge and the cron expires it immediately on the first due date rather than retrying — there's no retry path for "no payment method on file," only for "charge attempted and failed." Add a user-facing notification (email/SMS) a few days before expiry in this case so it isn't a silent surprise.
- Currency/amount conversion assumes 2 decimal places for both NGN and USD (`toMinorUnits` in `lib/payments.ts`) — correct for these two, but not a generic multi-currency helper if more currencies get added later.
- Signature schemes verified against each provider's current docs (see comments in `lib/payments.ts`) as of when this was written — providers do change these, so re-check if verification starts failing in production.
- Both webhook handlers do their DB work synchronously before responding. Both providers recommend acknowledging fast (Paystack retries for 72h if it doesn't get a quick 200; Flutterwave explicitly warns against long-running work in the handler). For MVP-scale traffic a few pooled-connection queries should complete well within their timeout windows, but if this becomes a bottleneck under load, move the DB write to a queue (e.g. Upstash QStash) and ack immediately.

## 8) Frontend status

**Public marketing + auth:** landing (`/`), plans (`/pricing`), sign up / log in (`/register`, `/login`), password reset (`/forgot-password`, `/reset-password`), and CMS-driven `/terms` + `/privacy`. Design direction: a "matchday scoreboard" identity (pitch-green/floodlight-amber palette, Space Grotesk + Inter + JetBrains Mono) with pricing plans rendered as torn ticket stubs — built from the product's own real "one booking code per post" concept rather than generic cards. See `app/globals.css` for the token system.

**User dashboard (`/dashboard`):** subscription status + cancel auto-renew, prediction feed (respects the paywall — locked/unlocked per `canView`), payment history, and a `/dashboard/security` page for 2FA setup. Deliberately plain/data-dense styling, distinct from the marketing site's ticket-stub flourish — an account page isn't trying to sell anything.

**Admin dashboard (`/admin`):** overview (webhook health), plans (list + create), predictions (list + manual create + publish), a CSV import wizard (upload → preview with row-level errors → confirm), users (paid/unpaid filter + CSV export), transactions, audit log, and a CMS section editor for terms/privacy. Protected by `middleware.ts` (redirects non-admins before the page even renders) plus each underlying API route independently checking `requireAdmin` — the middleware is a UX nicety, not the actual security boundary.

One thing to note: `/register` collects a country via a short dropdown (Nigeria, Ghana, Kenya, South Africa, UK, US, Other) rather than a full ISO country list or IP-based detection — good enough for MVP since it only needs to distinguish "Nigeria" (NGN pricing) from everywhere else (USD), but worth swapping for a proper picker or IP-based default before launch.

**Sign up now collects `name` and `phone`**, not just email/password/country — `User.name` is a required field (`prisma/migrations/0002_add_user_name`, added as its own migration rather than editing `0001_init`, since your database may already have that one applied — see the migration file's comment for why that distinction matters going forward). Both are editable afterward from `/dashboard/profile`. The header's top nav no longer links to `/pricing` directly (removed per request) — it's still reachable via the footer and the homepage/pricing CTAs, just decluttered from the primary nav.

## 9) What changed in the "make it production ready" pass

Starting point was an honest gap list: no refresh endpoint (users got logged out every 15 minutes), no password reset, no 2FA despite schema fields existing for it, inconsistent input validation, thin rate limiting, no session/anti-sharing tracking, no admin or user UI, no `/payments/callback`, no CI, no migrations ever actually run, zero tests. Status on each:

| Gap | Status |
|---|---|
| No `/api/auth/refresh` (live bug) | **Fixed** — route added, plus `lib/api-client.ts` so the frontend actually calls it on a 401 before giving up |
| No password reset | **Fixed** — request/confirm routes, `lib/email.ts` (Resend), `/forgot-password` + `/reset-password` pages. Requires `RESEND_API_KEY` to actually send; falls back to returning the link directly in non-production so it's testable without one |
| No 2FA despite schema fields | **Fixed** — TOTP via `otplib`, two-step login flow (`issueTwoFactorChallengeToken` → `/api/auth/2fa/login-verify`), setup/verify routes, `/dashboard/security` UI |
| Inconsistent validation | **Fixed** — `lib/schemas.ts` centralizes zod schemas; every admin mutation route and `payments/initialize` now validates input. `errorResponse()` formats `ZodError` automatically, so adding validation to a new route is just calling `.parse()` |
| Thin rate limiting | **Improved** — extended to `payments/initialize`, `media/signed-url`, `predictions` feed, password reset, and (Section 11) the two public unauthenticated GET routes |
| `UserSession` schema unused | **Fixed** — `lib/sessions.ts` tracks device fingerprint + IP on every login and exposes `isAnomalous()` (≥3 distinct devices in 24h). Deliberately a *signal*, not an automatic block — hard-blocking on this would punish legitimate shared-device/VPN users. Actually surfaced in the admin UI as of Section 12 |
| No admin/user dashboard | **Fixed** — see Section 8, extended further in Sections 12-13 |
| No `/payments/callback` | **Fixed** — polls `/api/payments/status` (new route) since webhook delivery isn't instant |
| No CI | **Fixed** — `.github/workflows/ci.yml`: install → `prisma generate` → `tsc --noEmit` → `vitest run` → `next build`, plus a separate `migrate` job gated to `main` pushes only |
| Migrations never run | **Partially fixed** — hand-authored `prisma/migrations/0001_init/migration.sql` directly from the schema. `prisma migrate dev` can't run in the sandbox this was built in (`binaries.prisma.sh`, which the real Prisma CLI needs to fetch its engine binary, isn't reachable from there — a sandbox-specific network restriction, not a real constraint on Vercel or any normal dev machine). Verify with `npx prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --script` in a normal environment before trusting this file against production — it should produce an empty diff if accurate |
| Zero tests | **Fixed, incrementally, across every pass** — 43 tests total now, see Section 13's table for the current breakdown |

The gaps that were **actual bugs** (refresh token, unused session schema) are fixed. The gaps that were **missing surface area** are now built and wired end-to-end, not stubbed.

## 10) Build verification: 3 real bugs `tsc` alone didn't catch

Type-checking against a hand-written Prisma stub (Section 15) is useful but isn't the same as an actual `next build`. Running one for the first time found:

1. **Next.js 15 breaking change**: dynamic route `params` became a `Promise` in the App Router. All 8 dynamic routes (`[id]`, `[page]`, `[postId]`) were still on the Next.js 14 signature — this would have failed the actual Vercel build outright, not just warned. Fixed across every affected route.
2. **Edge bundle leak**: `middleware.ts` imports `lib/auth.ts` for `verifyAccessToken`, but that file also exported `hashPassword`/`verifyPassword` (bcryptjs) — not Edge-compatible. Importing a module pulls in all of it, so bcryptjs was getting bundled into the Edge middleware. Split into `lib/auth.ts` (jose, edge-safe) and `lib/password.ts` (bcryptjs, Node-only).
3. **TypeScript closure narrowing**: a null-check on `sub.plan`/`sub.user` didn't persist inside a nested `prisma.$transaction(async (db) => ...)` callback (narrowing doesn't survive closure boundaries when the variable is captured by reference). Fixed by capturing the narrowed values into local consts before entering the closure.

Also closed in this pass:
- **No-payment-method-on-file handling** (`app/api/cron/renew`): previously expired these subscriptions immediately on the first cron run within the lookahead window. Now sends one reminder email (Resend) and gives a real grace period — only expires once `endAt` has actually passed. Added `Subscription.renewalReminderSentAt` to dedupe the email across multiple cron runs.
- Added `tests/auth.test.ts` (token roundtrips, including that access/refresh/2FA-challenge tokens can't be substituted for each other despite sharing a secret) and `tests/webhook-idempotency.test.ts` (an in-memory fake DB proving a replayed webhook doesn't double-create a subscription).

## 11) Security audit, round 1

Went through the codebase systematically looking for real vulnerability classes — found and fixed 7 issues.

| Finding | Severity | Fix |
|---|---|---|
| JWT secrets silently fell back to an empty-string signing key if unset (`TextEncoder.encode(undefined)` → `""`, not an error) | **High** — an empty HMAC key is forgeable, meaning anyone could mint valid admin sessions on a misconfigured deploy | `lib/auth.ts` now throws at module load if either secret is missing or under 32 chars |
| Webhook signature comparisons and the cron's `CRON_SECRET` check used plain `===` on secret values | **Medium** — timing attacks can extract a secret byte-by-byte | `lib/timing-safe.ts` (`crypto.timingSafeEqual`), used consistently |
| `sharp` pinned to a version with known-vulnerable bundled `libvips`; `postcss` (via Next.js) had a high-severity advisory | **High** (sharp) | Upgraded `sharp` to 0.35.3, `next` to 15.5.23 (security-patched, avoids the 16.x major). Confirmed `next/image` is unused (so Next's own older bundled sharp is unreachable dead code) and that postcss only ever processes this app's own authored CSS, never attacker-controlled input |
| Media upload had no file size/type validation, used the raw filename directly in the S3 key | **Medium** | 8MB cap, MIME allowlist, filename sanitized before use in the key |
| `/api/auth/register` had zero server-side validation (password length was frontend-only) | **Medium** | `RegisterSchema`/`LoginSchema` added |
| Public `GET /api/plans` and `GET /api/cms/[page]` had no rate limiting | **Low-Medium** | Both now rate-limited by IP |
| The `?next=` redirect param `middleware.ts` sets was unvalidated, and got wired into the login page for the first time in this same pass | **Medium** (open redirect) | `lib/safe-redirect.ts` — rejects absolute URLs and `//host` protocol-relative paths |

**Confirmed already correct:** every `/api/admin/*` route calls `requireAdmin` (grepped all 14 files); no `dangerouslySetInnerHTML` anywhere; no raw SQL (`$queryRaw` used zero times); cookies are `httpOnly`/`secure`/`sameSite: 'lax'`.

**Genuine residual risk, not fixed:** `x-forwarded-for` is trusted directly for rate-limiting keys. Correct specifically because Vercel's edge network sets this reliably and it can't be spoofed by the client there — would need `req.ip` or a platform header instead on any other host.

## 12) Design completion, round 1

Filled in admin UI gaps that were previously "API exists, no UI for it":

- **Plans**: full edit (was activate/deactivate-only).
- **Predictions**: a real edit page (`/admin/predictions/[id]`) — title/booking-code/notes, publish, **archive** (no UI path to it before despite the PRD listing it), image upload wired to the existing upload route.
- **Users**: a detail view (`/admin/users/[id]`) — subscriptions, transactions, and the device-anomaly signal from `lib/sessions.ts` that existed since an earlier pass but was never displayed anywhere.
- **CMS**: extended to `homepage` (an optional announcement banner) and `faq` — actually wired to render, not left as editable-but-invisible. The editor shows a note that only the `announcement` key currently renders on the homepage.
- **Login redirect**: closed the loop on `?next=<path>` (validated per Section 11).

## 13) PRD gap audit + security round 2

Re-read the PRD against the actual codebase — grepped for routes rather than trusting the previous passes' "done" list — and found real gaps, including one more serious bug.

**PRD-explicit features with zero implementation, now built:**
- **Global trial days / promo windows** (PRD Section 5) had a Prisma model and entitlement-check code, but *no API route to create one existed at all*. `/api/admin/free-access-rules` (+ `/admin/free-access` UI) closes that.
- **Complimentary access grants** — same story. `/api/admin/complimentary-access`, same admin page.
- **While building the above, found the entitlement check only ever queried `type: 'promo_window'` — `global_trial` rules were silently never checked**, despite the model, the route just built, and the design doc all describing it. This would have been an invisible failure: an admin configures a trial, nobody gets it, no error anywhere. Fixed in `lib/entitlement.ts` (a global trial is now correctly "N days from *that user's* signup date," not a shared calendar window) — 4 new tests specifically for this.
- **Profile editing** (PRD's dashboard "Profile & security" — security existed, profile didn't) — `PATCH /api/me`, scoped to `phone` only, `/dashboard/profile`.
- **Prediction edit form was missing `visibility`/`freeUntil`** despite the API supporting both.
- **Prediction detail page** (PRD: "feed **+ detail pages**" — only had the feed) — `/dashboard/predictions/[id]`.

**Security, one serious finding:**

| Finding | Severity | Fix |
|---|---|---|
| `GET /api/admin/users` had no `select` — returned the full `User` row to any admin, including `passwordHash` **and `twoFactorSecret`** (the raw TOTP seed) | **High** — leaking `twoFactorSecret` fully defeats 2FA for every user in the response | Added an explicit `SAFE_USER_FIELDS` select, then grepped every `prisma.user.*` call site (15 total) to confirm this was the only leak — everywhere else either constructs an explicit response shape or uses fields server-side only |
| CSV upload had no file-size or row-count cap | Low (admin-only) | 2MB file cap, 2000-row cap — resource-exhaustion hardening, not an auth bypass |

## 14) Real CI-caught bugs, across two rounds

GitHub Actions' CI run (using the *real* `prisma generate`, not the local sandbox stub) has now caught genuine bugs the sandbox couldn't, twice. Both rounds are recorded here since they're the same underlying story.

**Round 1 — missing `Transaction.planId`:** `lib/payments.ts` had been reading and writing `tx.planId` since `initializePayment` was first written, but **the `Transaction` model never actually had a `planId` field** — it's needed to remember which plan an initial purchase was for, before any `Subscription` row exists to trace it through. The local stub's `create()`/`update()` methods took `any` args, so this never got flagged locally.

Fixed properly, not just patched:
- Added `Transaction.planId String?` (nullable — renewal-created transactions trace their plan through `subscriptionId` instead) with a proper `Plan` relation, folded into `migration_0001_init` since no real migration has ever been applied to a live database yet.
- **Found a second, related structural gap while fixing this**: `activateOrRenewSubscription`'s `db` parameter (the `$transaction` callback client) was explicitly typed `db: any`, meaning *none* of its Prisma calls were checked by anything, ever — not the local stub, and not even the real CI Prisma client, since `any` suppresses checking regardless of how precise the underlying type is. Retyping it surfaced two more real null-safety gaps (`findUnique` can return `null`; the code wasn't guarding for it) — fixed with explicit checks that throw a clear error instead of crashing on `Cannot read property of null`. Found and fixed the same `any`-typed-callback pattern in one other place (`password-reset/confirm`).

**Round 2 — the retype from Round 1 was itself imprecise, and surfaced a real enum bug:** fixing Round 1 by typing `db` as a full `PrismaClient` was still wrong — real Prisma's `$transaction` callback actually provides `Prisma.TransactionClient` (`PrismaClient` minus `$connect`/`$disconnect`/`$transaction`/etc., since you can't reconnect or nest transactions from inside one), a distinction the local stub hadn't modeled at all. CI correctly rejected passing the real (narrower) transaction client into a parameter expecting the full client. Fixed by adding `Prisma.TransactionClient` to the local stub (matching real Prisma's actual namespaced export, not a flat one) and retyping the parameter correctly.

Fixing *that* surfaced a real, independent bug in the same function: `provider` was typed as plain `string`, but it flows into `Subscription.renewalProvider`, which is the `PaymentProvider` enum (`'paystack' | 'flutterwave'`) — real Prisma correctly rejected a bare `string` there. This one wasn't a stub gap at all; it was a genuinely too-loose parameter type that happened to compile locally only because the Delegate methods it flowed into were separately `any`-typed. Fixed by typing the parameter as `PaymentProvider` instead of widening it away.

Deliberately did **not** try to make the stub's `create`/`update` fully strict (e.g. `Partial<T>`) — the codebase legitimately uses nested relation-create syntax in a couple of places (`PredictionPost.create({ data: { items: { create: [...] } } })`) that a naive tightening would break. This is exactly what CI's real `prisma generate` is for; each round above found a real, different bug it wouldn't have caught either way.

Verified after each fix: `tsc` clean, all 43 tests still passing, full `next build` succeeds.

## 15) Admin/user dashboard sidebar

Both dashboards previously repeated the same header/nav/footer JSX in every single page file — the admin nav was a horizontal pill bar that had grown to 8 destinations (already cramped), and the user dashboard had **no consistent navigation at all**, just inline links buried inside page content.

Replaced with real Next.js layouts (`app/admin/layout.tsx`, `app/dashboard/layout.tsx`) wrapping every page under each route automatically — a `Sidebar` component (`components/Sidebar.tsx`, generic, takes a `title` + `items` list, active-link highlighting via `usePathname()`) plus a shared `DashboardHeader`. Vertical on desktop, collapses to a horizontal scrollable strip under 780px rather than disappearing behind a hamburger menu, since admin usage skews toward tablet/desktop but shouldn't outright break on a phone.

This ate ~15 page files' worth of repeated boilerplate. Did it with a script (`re.sub` stripping the known header/nav/footer/wrapper patterns) rather than 15 manual edits, then verified with `tsc --noEmit` (structural JSX mismatches would fail to compile) and a full `next build` (would fail to prerender/generate if anything were actually broken) rather than trusting the regex blindly. Two pages (`/dashboard/security`, `/dashboard/profile`) and one (`/dashboard/predictions/[id]`) had an intentional `maxWidth` on their old container that the strip removed along with it — caught by manually reviewing every modified file's `return` statement, not by the automated checks (a width regression doesn't fail a build), and restored.

Also added `lib/dashboard-user-context.tsx` — a `DashboardUserProvider`/`useDashboardUser()` pair so `/api/me` gets fetched once per layout mount instead of redundantly by nearly every page that needed to know `role` for the header's admin link. `AdminNav.tsx` (the old pill-bar component) is now dead code with the sidebar replacing it — deleted rather than left around.

## 16) Not yet built / genuinely open

Being precise about what's still missing rather than declaring victory:
- **No email notification tests against a real Resend account** — the code path is correct and falls back to a visible dev-mode link, but no real send has ever happened.
- **No live charge has ever been made** against Paystack or Flutterwave, sandbox or otherwise — only local builds and mocked tests.
- **No automated enforcement that every admin mutation calls `writeAudit`** — currently just consistent manual discipline, not a lint rule.
- **Plan switching/upgrades mid-cycle** isn't built — the PRD describes subscribe/renew-early/cancel, not switching plans, so this wasn't treated as a gap, but flagging it as a reasonable next ask.
- **Migrations have never run against a real database** — see Section 17.

## 17) A production-only bug `next build` cannot catch: conflicting dynamic route names

Real production logs showed `/api/auth/register` — completely unrelated to predictions — failing with `You cannot use different slug names for the same dynamic path ('id' !== 'postId')`. The actual cause: `app/api/admin/predictions/` had two sibling dynamic folders, `[id]` and `[postId]`. Next.js requires **every** dynamic segment at the same directory level, across the **entire app**, to share one parameter name — it builds a single global route manifest, so one conflict anywhere can break routing everywhere, not just for the conflicting paths themselves. That's exactly what happened: an unrelated endpoint failed because the app's route table as a whole couldn't resolve.

**Confirmed directly, not assumed**: reverted to the broken state locally and ran `next build` again — it succeeded silently. This class of error is invisible to `next build`; it only surfaces at runtime, on first request, in whatever environment actually serves traffic. Every "build succeeds" claim in this README up to now was true and still is, but had this specific blind spot.

Fixed by renaming `[postId]` to `[id]` to match its sibling (`app/api/admin/predictions/[id]/images/route.ts`). Then, since this obviously wasn't caught by any check that existed, wrote one: `scripts/check-route-conflicts.mjs` walks the entire `app/` tree looking for sibling directories with different dynamic segment names, and is now a required step in CI *before* the build — verified it actually catches the conflict by deliberately reintroducing it and confirming a non-zero exit code, not just assumed it would work.

## 18) Password field UX

Added a reusable `PasswordField` component (show/hide toggle) used consistently across login, register, and reset-password — previously each page had its own plain, always-masked `<input type="password">`. Register and reset-password (both "setting a new password" contexts) also get a confirm-password field with submit-time match validation, and a strength meter (`lib/password-strength.ts`, a simple length + character-variety heuristic — 6 tests, not just written but run). Login only gets the visibility toggle; grading the strength of a password someone's just trying to log in with doesn't make sense.

## 19) Rate limiting and FX caching now fail open, not closed

Real production logs: `/api/auth/register` was 500ing on every attempt (even after the Section 17 routing fix resolved the other pages). Cause: `UPSTASH_REDIS_REST_URL`/`TOKEN` weren't set in Vercel, and the `@upstash/redis` client threw an unhandled error trying to reach a relative `/pipeline` path with no configured host — which crashed the request, since `checkRateLimit()` (the very first `await` in the register handler) had no error handling around it.

The immediate fix is a config step on Vercel's side (add the real Upstash credentials), but the code had a real design gap worth fixing regardless: **rate limiting is defense-in-depth against abuse, not the primary security boundary** (auth/RBAC/validation are), so its own failure shouldn't be able to take down the functionality it's protecting. Fixed both Redis-dependent code paths to fail open instead of closed:

- `lib/ratelimit.ts`'s `checkRateLimit()` now catches errors from the underlying limiter and returns `true` (request allowed) rather than propagating the throw — logged, not silently swallowed.
- `lib/fx.ts`'s `getFxRate()` — sitting on the payment path, since a non-Nigerian user subscribing needs it for NGN→USD conversion — now treats a cache read failure as a cache miss (fetches the live rate instead) and a cache write failure as a non-fatal warning (the rate is still returned, it just doesn't get cached that time).

Verified with 4 new tests (`tests/resilience.test.ts`) that actually mock the underlying client to throw and confirm the fail-open behavior, rather than just asserting the try/catch exists structurally.

## 20) Login/register redirected to the homepage instead of the dashboard

Reported directly: after creating an account or logging in, users landed back on the marketing homepage instead of their dashboard. Two separate instances of the same root cause:

- `app/register/page.tsx` hardcoded `router.push('/')` after a successful signup + auto-login.
- `app/login/page.tsx` used `safeRedirectPath(searchParams.get('next'))` with no explicit fallback, which defaults to `'/'` — correct for *"send them back where they came from"* when middleware redirected them to `/login?next=/admin/plans`, but wrong for the far more common case of someone just navigating to `/login` directly with no `next` param at all.

Fixed by adding an optional `fallback` parameter to `safeRedirectPath()` (defaults to `/` for any caller that genuinely wants the homepage — the open-redirect protection itself is unchanged) and having both login and register default to `/dashboard` instead. Both of login's success paths (password-only and the 2FA-code step) already shared one `destination` variable, so this was a one-line fix there; register's hardcoded push was the other. Added a test for the new parameter rather than just trusting the default-argument behavior.

## 21) Dashboard sidebar nav was invisible on mobile

Reported directly, with a screenshot: after logging in, the sidebar navigation was there but effectively invisible — two compounding problems, both from the sidebar (Section 15) having been added *after* the dashboard's original content, without cleaning up what predated it:

- `app/dashboard/page.tsx` still had "Security settings →" and "Edit profile →" inline text links — leftovers from before the sidebar existed, when they were the only way to reach those pages. After the sidebar added proper `Profile`/`Security` nav items, these became redundant duplicates styled completely differently from the sidebar, which is exactly the kind of inconsistency that makes someone unsure which UI is "the real navigation." Removed them.
- On mobile (<780px), the sidebar collapses to a horizontal row (Section 15) — but its title label is hidden there to save space, and the row itself had no visual container distinguishing it from the page around it. Result: an unlabeled row of text sitting in open space, easy to read as decoration rather than navigation. Gave it a contained background/padding (matching `.card`'s panel styling used everywhere else in the app) so it reads as one cohesive nav bar. The `<nav aria-label>` was already correct for screen readers regardless — this was a purely visual/sighted-user problem.

## 22) Final verification state (accumulated across every pass)

Same rigor every time — actually ran each command in this sandbox, not just wrote code:

| Check | Result |
|---|---|
| `node scripts/check-route-conflicts.mjs` | **Clean** — and confirmed the script itself works by deliberately reintroducing the Section 17 bug and verifying detection |
| `npx tsc --noEmit` | **Clean, zero errors** |
| `npx vitest run` | **54/54 passing** — 15 entitlement, 6 password strength, 5 CSV validation, 5 price/currency resolution, 6 auth token flows, 3 webhook idempotency, 10 security, 4 resilience (fail-open behavior) |
| `npx next build` | **Succeeds completely — 68 routes**, verified with a temporary font swap only, since `fonts.googleapis.com` is the one remaining unreachable host in this sandbox (Vercel's build servers reach it normally; not a real constraint) |
| `npm audit` | Two findings remain, both documented as not exploitable in this app's actual usage (Section 11) — not silently suppressed |
| GitHub Actions CI | Caught a real bug (Section 14, missing `Transaction.planId`) that the local sandbox's Prisma stub structurally couldn't; production logs caught two more classes of bug (Sections 17 and 19) that neither CI nor local `next build` catch at all — each layer of verification has genuinely different blind spots, which is exactly why relying on only one was never enough |

**What no amount of local checking substitutes for**: an actual request against a live Postgres/Redis instance, a real charge against Paystack/Flutterwave, and real email delivery through Resend. The CI workflow now runs the exact `next build`/`tsc`/`vitest`/route-conflict checks above on every push to GitHub — that's real, continuous verification this code didn't have before it existed.
