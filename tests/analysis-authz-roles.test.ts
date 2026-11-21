import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  verifyAccessToken: vi.fn(),
  findUnique: vi.fn(),
}));

// Exercise the REAL rbac chain (requireAnalysisAdmin → requireSuperAdmin →
// requireUser) by mocking only the token verifier and the user lookup.
vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof import('@/lib/auth')>('@/lib/auth');
  return { ...actual, verifyAccessToken: mocks.verifyAccessToken };
});

vi.mock('@/lib/prisma', () => ({
  prisma: { user: { findUnique: mocks.findUnique } },
}));

import { requireAnalysisAdmin } from '@/lib/analysis/api-auth';

function request(headers: Record<string, string> = {}) {
  return new NextRequest('http://localhost:3000/api/superadmin/analysis/results', {
    headers: { host: 'localhost:3000', ...headers },
  });
}

describe('requireAnalysisAdmin role matrix', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated requests without a session cookie', async () => {
    await expect(requireAnalysisAdmin(request())).rejects.toThrow('Missing session');
    expect(mocks.verifyAccessToken).not.toHaveBeenCalled();
  });

  it('rejects a plain user', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ sub: 'user-1', role: 'user' });
    mocks.findUnique.mockResolvedValue({ deletedAt: null });

    await expect(requireAnalysisAdmin(request({ cookie: 'access_token=user-token' })))
      .rejects.toThrow('Super admin access required');
  });

  it('rejects an admin (non-superadmin)', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ sub: 'admin-1', role: 'admin' });
    mocks.findUnique.mockResolvedValue({ deletedAt: null, permissions: [], twoFactorEnabled: true });

    await expect(requireAnalysisAdmin(request({ cookie: 'access_token=admin-token' })))
      .rejects.toThrow('Super admin access required');
  });

  it('rejects a deactivated account', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ sub: 'user-2', role: 'superadmin' });
    mocks.findUnique.mockResolvedValue({ deletedAt: new Date() });

    await expect(requireAnalysisAdmin(request({ cookie: 'access_token=stale' })))
      .rejects.toThrow('Account has been deactivated');
  });

  it('rejects a superadmin without two-factor authentication', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ sub: 'sa-1', role: 'superadmin' });
    mocks.findUnique.mockResolvedValue({ deletedAt: null, permissions: [], twoFactorEnabled: false });

    await expect(requireAnalysisAdmin(request({ cookie: 'access_token=sa-token' })))
      .rejects.toThrow('Admin account requires two-factor authentication');
  });

  it('allows a superadmin with two-factor authentication', async () => {
    mocks.verifyAccessToken.mockResolvedValue({ sub: 'sa-1', role: 'superadmin' });
    mocks.findUnique.mockResolvedValue({ deletedAt: null, permissions: [], twoFactorEnabled: true });

    const user = await requireAnalysisAdmin(request({ cookie: 'access_token=sa-token' }));
    expect(user).toMatchObject({ sub: 'sa-1', role: 'superadmin' });
  });

  it('rejects an invalid or expired session token', async () => {
    mocks.verifyAccessToken.mockResolvedValue(null);

    await expect(requireAnalysisAdmin(request({ cookie: 'access_token=bad' })))
      .rejects.toThrow('Invalid or expired session');
  });
});
