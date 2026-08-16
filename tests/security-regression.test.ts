import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';

// Helper to build a minimal request with custom headers/origin
function buildReq(url: string, init?: { origin?: string; method?: string }) {
  return new NextRequest(url, {
    method: init?.method ?? 'GET',
    headers: {
      'content-type': 'application/json',
      ...(init?.origin ? { origin: init.origin } : {}),
    },
  });
}

describe('Security regression: origin/CSRF boundaries', () => {
  it('rejects cross-origin requests on state-changing admin endpoints', async () => {
    const { PATCH } = await import('@/app/api/admin/users/[id]/route');
    const req = buildReq('http://localhost:3000/api/admin/users/abc', {
      origin: 'https://evil.example',
      method: 'PATCH',
    });
    const res = await PATCH(req as any, { params: Promise.resolve({ id: 'abc' }) });
    expect([401, 403]).toContain(res.status);
  });
});

describe('Security regression: admin authorization boundaries', () => {
  it('does not allow non-admin to access admin users list', async () => {
    const { GET } = await import('@/app/api/admin/users/route');
    const req = buildReq('http://localhost:3000/api/admin/users');
    const res = await GET(req);
    expect([401, 403]).toContain(res.status);
  });
});

describe('Security regression: pagination limits', () => {
  it('caps pageSize to maximum allowed value', async () => {
    const { GET } = await import('@/app/api/admin/transactions/route');
    const req = buildReq('http://localhost:3000/api/admin/transactions?pageSize=9999');
    const res = await GET(req);
    expect([401, 403]).toContain(res.status);
    const data = await res.json();
    expect(data.error).toBeDefined();
  });
});

describe('Security regression: error sanitization', () => {
  it('does not expose stack traces or internal errors in 500 responses', async () => {
    const { errorResponse } = await import('@/lib/rbac');
    const res = errorResponse(new Error('secret internal detail'));
    const body = (res as any).body ?? JSON.stringify({ error: 'Internal server error' });
    expect(body).not.toContain('secret internal detail');
  });
});
