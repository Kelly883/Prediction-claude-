import { describe, it, expect } from 'vitest';

describe('access/refresh token roundtrip', () => {
  it('issues a token that verifies back to the same payload', async () => {
    const { issueAccessToken, verifyAccessToken } = await import('@/lib/auth');
    const token = await issueAccessToken({ sub: 'user-1', role: 'admin' });
    const payload = await verifyAccessToken(token);
    expect(payload).toEqual({ sub: 'user-1', role: 'admin' });
  });

  it('rejects a garbage token', async () => {
    const { verifyAccessToken } = await import('@/lib/auth');
    expect(await verifyAccessToken('not-a-real-token')).toBeNull();
  });

  it('refresh tokens verify and carry the subject through', async () => {
    const { issueRefreshToken, verifyRefreshToken } = await import('@/lib/auth');
    const token = await issueRefreshToken('user-42');
    const payload = await verifyRefreshToken(token);
    expect(payload?.sub).toBe('user-42');
  });

  it('an access token cannot be used as a refresh token', async () => {
    const { issueAccessToken, verifyRefreshToken } = await import('@/lib/auth');
    const accessToken = await issueAccessToken({ sub: 'user-1', role: 'user' });
    // Same secret in this test env, but wrong `type` claim — must be rejected.
    expect(await verifyRefreshToken(accessToken)).toBeNull();
  });
});

describe('two-factor challenge token', () => {
  it('roundtrips and is distinguishable from a refresh token', async () => {
    const { issueTwoFactorChallengeToken, verifyTwoFactorChallengeToken, verifyRefreshToken } = await import('@/lib/auth');
    const token = await issueTwoFactorChallengeToken('user-7');
    expect(await verifyTwoFactorChallengeToken(token)).toEqual({ sub: 'user-7' });
    // A 2FA challenge token must not also pass as a refresh token — they're
    // signed with the same secret, so the `type` claim is the only thing
    // stopping one from being replayed as the other.
    expect(await verifyRefreshToken(token)).toBeNull();
  });
});

describe('password hashing', () => {
  it('hashes are not the plaintext and verify correctly', async () => {
    const { hashPassword, verifyPassword } = await import('@/lib/password');
    const hash = await hashPassword('correct horse battery staple');
    expect(hash).not.toBe('correct horse battery staple');
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
    expect(await verifyPassword('wrong password', hash)).toBe(false);
  });
});
