import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { getRequestId, withRequestId } from '@/lib/request-id';

describe('Security: request-id', () => {
  it('generates a UUID when no x-request-id header is present', async () => {
    const req = new NextRequest('http://localhost/test');
    const id = getRequestId(req);
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('validates and reuses a supplied x-request-id header', async () => {
    const req = new NextRequest('http://localhost/test', {
      headers: { 'x-request-id': 'abc-123' },
    });
    const id = getRequestId(req);
    expect(id).toBe('abc-123');
  });

  it('rejects invalid x-request-id values and generates a fallback', async () => {
    const req = new NextRequest('http://localhost/test', {
      headers: { 'x-request-id': '<script>alert(1)</script>' },
    });
    const id = getRequestId(req);
    expect(id).not.toBe('<script>alert(1)</script>');
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('attaches x-request-id to response headers', async () => {
    const req = new NextRequest('http://localhost/test');
    const res = new NextResponse('ok');
    const result = withRequestId(req, res);
    const header = result.headers.get('x-request-id');
    expect(header).toBeTruthy();
    expect(header).toMatch(/^[0-9a-f-]{36}$/);
  });
});
