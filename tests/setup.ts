// Runs before every test file. JWT_ACCESS_SECRET/JWT_REFRESH_SECRET must be
// set before lib/auth.ts is first imported anywhere in the chain (it throws
// otherwise, by design — see the comment in lib/auth.ts) — including
// transitively, e.g. lib/payments.ts -> lib/rbac.ts -> lib/auth.ts.
process.env.JWT_ACCESS_SECRET = 'test-secret-at-least-32-bytes-long-ok';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-at-least-32-bytes';
