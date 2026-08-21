# PredictPro Security Hardening Baseline

## Environment

- **Date:** 2026-08-21
- **Commit:** d56241a5fd4f8a61353565383add07d11176ec8e
- **Node.js:** v22.22.3
- **npm:** 10.9.8
- **Package manager:** npm
- **Database:** PostgreSQL (Prisma ORM)
- **Deployment target:** Vercel/serverless

## Baseline Commands

### npm install
```
added 255 packages, and audited 256 packages in 38s
found 0 vulnerabilities
```

### TypeScript (`npx tsc --noEmit`)
PASS — no output (no type errors)

### Lint (`npm run lint`)
**ISSUE:** `next lint` is deprecated in Next.js 15 and prompts for ESLint configuration interactively. No `.eslintrc.*` or `eslint.config.*` file exists. The command does not complete non-interactively.

### Tests (`npm test`)
PASS — 249 tests passed across 44 test files.

### Build (`npm run build`)
PASS — Production build succeeded. Warning: `lib/auth.ts` loads `crypto` module which is flagged as not supported in Edge Runtime (this is a known false-positive for Node.js runtime server actions).

### Prisma Validate (`npx prisma validate`)
FAIL — Missing `DIRECT_URL` environment variable. The schema references `env("DIRECT_URL")` but it is not set in the current environment.

### Prisma Generate (`npx prisma generate`)
PASS — Generated Prisma Client v5.22.0.

### Route Check (`npm run check-routes`)
PASS — No conflicting dynamic route segment names.

### Security Workflow Status
GitHub Actions workflows exist:
- `.github/workflows/ci.yml` — runs dependency audit, static security scan, route check, Prisma generate, TypeScript, unit tests, build
- `.github/workflows/security.yml` — runs CodeQL, dependency review (continue-on-error: true), secret scanning status check

**Note:** `dependency-review` has `continue-on-error: true` (does not block PR).

### Existing Security-Related Tests
The project has extensive security test coverage:
- `tests/security/auth.test.ts`
- `tests/security/authorization.test.ts`
- `tests/security/csrf.test.ts`
- `tests/security/sessions.test.ts`
- `tests/security/request-id.test.ts`
- `tests/security.test.ts`
- `tests/security-regression.test.ts`
- `tests/account-lockout.test.ts`
- `tests/encryption.test.ts`
- `tests/totp-encryption.test.ts`
- `tests/image-upload-security.test.ts`
- `tests/payment-security.test.ts`
- `tests/ratelimit.test.ts`
- `tests/resilience.test.ts`
