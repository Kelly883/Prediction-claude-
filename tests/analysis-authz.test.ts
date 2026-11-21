import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireSuperAdmin = vi.hoisted(() => vi.fn());

vi.mock('@/lib/rbac', async () => {
  const actual = await vi.importActual<any>('@/lib/rbac');
  return {
    ...actual,
    requireSuperAdmin,
  };
});

import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/superadmin/analysis/results', {
    headers: { host: 'localhost:3000', ...headers },
  });
}

describe('requireAnalysisAdmin', () => {
  const originalNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.clearAllMocks();
    requireSuperAdmin.mockResolvedValue({ sub: 'superadmin-1', role: 'superadmin' });
  });

  afterEach(() => {
    (process.env as any).NODE_ENV = originalNodeEnv;
  });

  it('allows same-origin reads for superadmins', async () => {
    const user = await requireAnalysisAdmin(request({
      origin: 'http://localhost:3000',
    }));

    expect(user).toMatchObject({ sub: 'superadmin-1' });
    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-origin requests before authorization', async () => {
    await expect(requireAnalysisAdmin(request({ origin: 'http://evil.example' })))
      .rejects.toThrow('Forbidden cross-origin request');
    expect(requireSuperAdmin).not.toHaveBeenCalled();
  });

  it('requires a CSRF token for mutations outside tests', async () => {
    (process.env as any).NODE_ENV = 'production';

    await expect(requireAnalysisAdmin(request({
      origin: 'http://localhost:3000',
    }), true)).rejects.toThrow('Invalid CSRF token');
    expect(requireSuperAdmin).not.toHaveBeenCalled();
  });

  it('accepts a matching CSRF token for mutations', async () => {
    (process.env as any).NODE_ENV = 'production';

    const user = await requireAnalysisAdmin(request({
      origin: 'http://localhost:3000',
      cookie: 'x-csrf-token=abc123',
      'x-csrf-token': 'abc123',
    }), true);

    expect(user).toMatchObject({ sub: 'superadmin-1' });
    expect(requireSuperAdmin).toHaveBeenCalledTimes(1);
  });
});
