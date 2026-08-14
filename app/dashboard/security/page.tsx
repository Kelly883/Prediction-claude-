'use client';

import { useState } from 'react';
import { apiJson } from '@/lib/api-client';

export default function SecurityPage() {
  const [secret, setSecret] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [status, setStatus] = useState<'idle' | 'setting-up' | 'verifying' | 'enabled' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function startSetup() {
    setStatus('setting-up');
    setError(null);
    try {
      const data = await apiJson<{ secret: string }>('/api/auth/2fa/setup', { method: 'POST' });
      setSecret(data.secret);
    } catch (err) {
      setError((err as Error).message);
      setStatus('error');
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setStatus('verifying');
    setError(null);
    try {
      await apiJson('/api/auth/2fa/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code }) });
      setStatus('enabled');
    } catch (err) {
      setError((err as Error).message);
      setStatus('setting-up');
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>SECURITY</div>
          <h1 className="display" style={{ fontSize: 28, marginBottom: 24 }}>Two-factor authentication</h1>

          <div className="card">
            {status === 'idle' && (
              <>
                <p style={{ color: 'var(--chalk-muted)', marginBottom: 16 }}>
                  Add an authenticator app (Google Authenticator, 1Password, Authy) as a second step at login.
                </p>
                <button onClick={startSetup} className="btn btn-primary">Set up 2FA</button>
              </>
            )}

            {(status === 'setting-up' || status === 'verifying') && secret && (
              <form onSubmit={confirmCode}>
                <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 12 }}>
                  Enter this secret into your authenticator app manually, then confirm with the code it generates:
                </p>
                <div className="mono" style={{ background: 'var(--pitch)', padding: 12, borderRadius: 4, marginBottom: 20, wordBreak: 'break-all', fontSize: 14 }}>
                  {secret}
                </div>
                <div className="field">
                  <label htmlFor="code">6-digit code</label>
                  <input id="code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
                </div>
                {error && <div className="error-text">{error}</div>}
                <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={status === 'verifying'}>
                  {status === 'verifying' ? 'Verifying…' : 'Confirm and enable'}
                </button>
              </form>
            )}

            {status === 'enabled' && (
              <p style={{ color: 'var(--floodlight)' }}>Two-factor authentication is now enabled on your account.</p>
            )}

            {status === 'error' && <p className="error-text">{error}</p>}
          </div>
    </div>
  );
}
