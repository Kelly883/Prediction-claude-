import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

describe('P1-04 Global Security Headers', () => {
  it('should have security headers defined in next.config.js', async () => {
    const config = (await import('../../../../next.config.js')).default;
    const headers = await config.headers();

    expect(headers).toBeDefined();
    expect(headers.length).toBeGreaterThan(0);

    const headerKeys = headers[0].headers.map((h: any) => h.key);

    expect(headerKeys).toContain('Content-Security-Policy');
    expect(headerKeys).toContain('X-XSS-Protection');
    expect(headerKeys).toContain('X-Frame-Options');
    expect(headerKeys).toContain('X-Content-Type-Options');
    expect(headerKeys).toContain('Referrer-Policy');
    expect(headerKeys).toContain('Permissions-Policy');
    expect(headerKeys).toContain('Cross-Origin-Opener-Policy');
    expect(headerKeys).toContain('Cross-Origin-Embedder-Policy');
    expect(headerKeys).toContain('Strict-Transport-Security');

    const headerMap = new Map(headers[0].headers.map((h: any) => [h.key, h.value]));

    expect(headerMap.get('X-Frame-Options')).toBe('DENY');
    expect(headerMap.get('X-Content-Type-Options')).toBe('nosniff');
    expect(headerMap.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(headerMap.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(headerMap.get('Cross-Origin-Embedder-Policy')).toBe('require-corp');
    expect(headerMap.get('Strict-Transport-Security')).toContain('max-age=63072000');
    expect(headerMap.get('Strict-Transport-Security')).toContain('includeSubDomains');
    expect(headerMap.get('Strict-Transport-Security')).toContain('preload');
  });

  it('should not allow unsafe-inline in CSP if possible', async () => {
    const config = (await import('../../../../next.config.js')).default;
    const headers = await config.headers();
    const csp = headers[0].headers.find((h: any) => h.key === 'Content-Security-Policy')?.value;

    if (csp) {
      const hasUnsafeInline = csp.includes("'unsafe-inline'");
      const hasUnsafeEval = csp.includes("'unsafe-eval'");

      if (hasUnsafeInline || hasUnsafeEval) {
        console.warn('CSP contains unsafe-inline or unsafe-eval — consider tightening with nonces or strict-dynamic');
      }

      expect(csp).toContain('frame-ancestors \'none\'');
      expect(csp).toContain('object-src \'none\'');
      expect(csp).toContain('base-uri \'self\'');
      expect(csp).toContain('form-action \'self\'');
    }
  });
});
