import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

describe('Rate Limiting Architecture & Fail-Closed Policies', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('fails closed (throws 503) for security-critical AUTH limiter when Redis fails', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const brokenLimiter = {
      limit: vi.fn().mockRejectedValue(new Error('Redis connection timed out')),
      failClosed: true,
    } as any;

    await expect(checkRateLimit(brokenLimiter, '127.0.0.1')).rejects.toThrow(
      'Security service temporarily unavailable. Please try again shortly.',
    );
    await expect(checkRateLimit(brokenLimiter, '127.0.0.1')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('fails closed when checking by policy string (AUTH, PAYMENT, ADMIN)', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const brokenAuthLimiter = {
      limit: vi.fn().mockRejectedValue(new Error('Redis down')),
      failClosed: true,
    } as any;

    await expect(
      checkRateLimit(brokenAuthLimiter, ['192.168.1.1', 'email:test@example.com'], { failClosed: true }),
    ).rejects.toMatchObject({ status: 503 });
  });

  it('fails open for unauthenticated PUBLIC endpoints when Redis fails', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const brokenPublicLimiter = {
      limit: vi.fn().mockRejectedValue(new Error('Redis down')),
      failClosed: false,
    } as any;

    const allowed = await checkRateLimit(brokenPublicLimiter, '127.0.0.1');
    expect(allowed).toBe(true);
  });

  it('blocks request if ANY of the dual identifiers (IP or Email) exceeds rate limit', async () => {
    const { checkRateLimit } = await import('@/lib/ratelimit');
    const mockLimiter = {
      limit: vi.fn().mockImplementation(async (id: string) => {
        if (id === 'email:attacker@example.com') return { success: false };
        return { success: true };
      }),
    } as any;

    const allowed = await checkRateLimit(mockLimiter, ['192.168.1.1', 'email:attacker@example.com']);
    expect(allowed).toBe(false);
  });

  it('extracts sanitized client IP correctly and ignores invalid spoofed headers', async () => {
    const { getClientIp, normalizeIdentifier } = await import('@/lib/ratelimit');

    const reqWithForwarded = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': '203.0.113.195, 70.41.3.18, 150.172.238.178' },
    });
    expect(getClientIp(reqWithForwarded)).toBe('203.0.113.195');

    const reqWithRealIp = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-real-ip': '198.51.100.42' },
    });
    expect(getClientIp(reqWithRealIp)).toBe('198.51.100.42');

    const reqWithInvalidHeader = new NextRequest('http://localhost/api/auth/login', {
      headers: { 'x-forwarded-for': 'invalid-ip-string' },
    });
    expect(getClientIp(reqWithInvalidHeader)).toBe('127.0.0.1');

    expect(normalizeIdentifier('email', '  User.Name+Test@Example.COM ')).toBe('email:user.name+test@example.com');
    expect(normalizeIdentifier('user', ' user-123 ')).toBe('user:user-123');
  });
});
