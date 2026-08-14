/**
 * middleware.ts sets ?next=<path> when redirecting an unauthenticated visitor
 * to /login. That value is attacker-controllable (it's a URL query param —
 * anyone can craft a link like /login?next=https://evil.com/phish), so it
 * must never be used as a redirect target without validation. Only a path
 * that's unambiguously same-origin and relative is allowed; anything else
 * (an absolute URL, or a protocol-relative "//evil.com" — which browsers
 * treat as scheme-relative to a different host) falls back to `fallback`.
 *
 * `fallback` defaults to "/" for callers that genuinely want the homepage,
 * but a normal login/register with no `next` param (i.e. the person just
 * navigated to /login directly, not via a middleware redirect from a
 * protected page) should land on /dashboard, not the marketing homepage —
 * see the call sites in app/login and app/register.
 */
export function safeRedirectPath(next: string | null | undefined, fallback: string = '/'): string {
  if (!next) return fallback;
  if (!next.startsWith('/') || next.startsWith('//')) return fallback;
  return next;
}
