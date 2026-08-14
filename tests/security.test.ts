import { describe, it, expect } from 'vitest';
import { timingSafeStringEqual } from '@/lib/timing-safe';
import { safeRedirectPath } from '@/lib/safe-redirect';

describe('timingSafeStringEqual', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeStringEqual('abc123', 'abc123')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeStringEqual('abc123', 'abc124')).toBe(false);
  });

  it('returns false (not throws) for different-length strings', () => {
    expect(timingSafeStringEqual('short', 'a-lot-longer-string')).toBe(false);
  });

  it('returns false for empty vs non-empty', () => {
    expect(timingSafeStringEqual('', 'nonempty')).toBe(false);
  });
});

describe('safeRedirectPath', () => {
  it('allows a plain relative path', () => {
    expect(safeRedirectPath('/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('/admin/plans')).toBe('/admin/plans');
  });

  it('falls back to / for null or empty', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath('')).toBe('/');
  });

  it('rejects absolute URLs to other hosts (open redirect)', () => {
    expect(safeRedirectPath('https://evil.com/phish')).toBe('/');
    expect(safeRedirectPath('http://evil.com')).toBe('/');
  });

  it('rejects protocol-relative URLs (browsers treat // as scheme-relative)', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/');
    expect(safeRedirectPath('//evil.com/dashboard')).toBe('/');
  });

  it('rejects paths not starting with /', () => {
    expect(safeRedirectPath('evil.com')).toBe('/');
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/');
  });

  it('uses a custom fallback when provided (e.g. login/register defaulting to /dashboard)', () => {
    expect(safeRedirectPath(null, '/dashboard')).toBe('/dashboard');
    expect(safeRedirectPath('https://evil.com', '/dashboard')).toBe('/dashboard');
    // A valid explicit path still wins over the fallback regardless of what it is
    expect(safeRedirectPath('/admin/plans', '/dashboard')).toBe('/admin/plans');
  });
});
