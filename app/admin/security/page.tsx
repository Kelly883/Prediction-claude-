'use client';

import { useEffect, useState } from 'react';
import { apiJson, apiFetch } from '@/lib/api-client';

type SetupResult = { secret: string; otpauthUri: string };

export default function AdminSecurityPage() {
  const [loading, setLoading] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);
  const [recoveryRemaining, setRecoveryRemaining] = useState(0);

  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupOtpUri, setSetupOtpUri] = useState<string | null>(null);
  const [verifyCode, setVerifyCode] = useState('');
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'verifying' | 'enabled' | 'error'>('idle');
  const [verifyError, setVerifyError] = useState<string | null>(null);

  const [disablePassword, setDisablePassword] = useState('');
  const [disableCode, setDisableCode] = useState('');
  const [disableStatus, setDisableStatus] = useState<'idle' | 'disabling' | 'disabled' | 'error'>('idle');
  const [disableError, setDisableError] = useState<string | null>(null);

  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [recoveryStatus, setRecoveryStatus] = useState<'idle' | 'generating' | 'generated' | 'error'>('idle');
  const [recoveryError, setRecoveryError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      setSetupSecret(null);
      setSetupOtpUri(null);
      setRecoveryCodes(null);
    };
  }, []);

  async function loadStatus() {
    try {
      const data = await apiJson<{ twoFactorEnabled: boolean }>('/api/auth/2fa/status');
      setTwoFactorEnabled(data.twoFactorEnabled);
      if (data.twoFactorEnabled) {
        const recovery = await apiJson<{ remaining: number }>('/api/auth/2fa/recovery-codes', { method: 'GET' });
        setRecoveryRemaining(recovery.remaining);
      }
    } catch {
      // ignore load errors
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadStatus();
  }, []);

  async function startSetup() {
    setActionError(null);
    setVerifyStatus('idle');
    setVerifyError(null);
    try {
      const data = await apiJson<SetupResult>('/api/auth/2fa/setup', { method: 'POST' });
      setSetupSecret(data.secret);
      setSetupOtpUri(data.otpauthUri ?? null);
    } catch (err) {
      setActionError((err as Error).message);
    }
  }

  async function confirmCode(e: React.FormEvent) {
    e.preventDefault();
    setVerifyStatus('verifying');
    setVerifyError(null);
    try {
      await apiJson('/api/auth/2fa/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: verifyCode }),
      });
      setVerifyStatus('enabled');
      setTwoFactorEnabled(true);
      setSetupSecret(null);
      setSetupOtpUri(null);
      setVerifyCode('');
      loadStatus();
    } catch (err) {
      setVerifyError((err as Error).message);
      setVerifyStatus('error');
    }
  }

  async function disableTwoFactor(e: React.FormEvent) {
    e.preventDefault();
    setDisableStatus('disabling');
    setDisableError(null);
    try {
      await apiJson('/api/auth/2fa/disable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: disablePassword || undefined, code: disableCode || undefined }),
      });
      setDisableStatus('disabled');
      setTwoFactorEnabled(false);
      setDisablePassword('');
      setDisableCode('');
      loadStatus();
    } catch (err) {
      setDisableError((err as Error).message);
      setDisableStatus('error');
    }
  }

  async function generateRecoveryCodes() {
    setActionError(null);
    setRecoveryStatus('generating');
    setRecoveryError(null);
    try {
      const data = await apiJson<{ codes: string[] }>('/api/auth/2fa/recovery-codes', { method: 'POST' });
      setRecoveryCodes(data.codes);
      setRecoveryStatus('generated');
      loadStatus();
    } catch (err) {
      setRecoveryError((err as Error).message);
      setRecoveryStatus('error');
    }
  }

  if (loading) {
    return <div className="admin-loading">Loading security settings…</div>;
  }

  const qrSrc = setupOtpUri ? `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(setupOtpUri)}` : null;

  return (
    <div className="space-y-6">
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Security</div>
        <h1 className="admin-page-title">Two-factor authentication</h1>
        <p className="admin-page-subtitle">Protect your admin account with an authenticator app and recovery codes.</p>
        <div className="admin-underline" />
      </div>

      {actionError && (
        <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
          <span>{actionError}</span>
        </div>
      )}

      <div className="card p-4 sm:p-5">
        {!twoFactorEnabled && !setupSecret && (
          <>
            <p style={{ color: 'var(--chalk-muted)', marginBottom: 16 }}>
              Add an authenticator app (Google Authenticator, 1Password, Authy) as a second step at login.
            </p>
            <button onClick={startSetup} className="btn btn-primary">Set up 2FA</button>
          </>
        )}

        {!twoFactorEnabled && setupSecret && verifyStatus !== 'enabled' && (
          <form onSubmit={confirmCode}>
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 12 }}>
              Enter this secret into your authenticator app manually, then confirm with the code it generates:
            </p>
            <div className="mono" style={{ background: 'var(--pitch)', padding: 12, borderRadius: 4, marginBottom: 20, wordBreak: 'break-all', fontSize: 14 }}>
              {setupSecret}
            </div>
            {qrSrc && (
              <img
                src={qrSrc}
                alt="2FA QR code"
                style={{ width: 200, height: 200, marginBottom: 20, borderRadius: 8, border: '1px solid rgba(243,245,236,0.1)' }}
              />
            )}
            <div className="field">
              <label htmlFor="code">6-digit code</label>
              <input id="code" inputMode="numeric" required value={verifyCode} onChange={(e) => setVerifyCode(e.target.value)} placeholder="123456" />
            </div>
            {verifyError && <div className="error-text" style={{ marginBottom: 12 }}>{verifyError}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={verifyStatus === 'verifying'}>
              {verifyStatus === 'verifying' ? 'Verifying…' : 'Confirm and enable'}
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: '100%', marginTop: 8 }} onClick={() => { setSetupSecret(null); setVerifyCode(''); }}>
              Cancel
            </button>
          </form>
        )}

        {verifyStatus === 'enabled' && (
          <div style={{ color: 'var(--floodlight)', marginBottom: 12 }}>
            Two-factor authentication is now enabled on your account.
          </div>
        )}

        {twoFactorEnabled && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ color: 'var(--floodlight)' }}>Two-factor authentication is enabled.</div>

            <form onSubmit={disableTwoFactor} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="field">
                <label htmlFor="disablePassword">Current password</label>
                <input id="disablePassword" type="password" value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} placeholder="••••••••" />
              </div>
              <div className="field">
                <label htmlFor="disableCode">Or authenticator code</label>
                <input id="disableCode" inputMode="numeric" value={disableCode} onChange={(e) => setDisableCode(e.target.value)} placeholder="123456" />
              </div>
              {disableError && <div className="error-text">{disableError}</div>}
              <button type="submit" className="btn btn-ghost" style={{ borderColor: 'rgba(239, 68, 68, 0.4)', color: '#f87171' }} disabled={disableStatus === 'disabling'}>
                {disableStatus === 'disabling' ? 'Disabling…' : 'Disable 2FA'}
              </button>
            </form>

            <div style={{ borderTop: '1px solid rgba(243,245,236,0.1)', paddingTop: 16 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>Recovery codes</div>
                  <div style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                    {recoveryRemaining} code{recoveryRemaining === 1 ? '' : 's'} remaining
                  </div>
                </div>
                <button type="button" onClick={generateRecoveryCodes} className="btn btn-primary" disabled={recoveryStatus === 'generating'}>
                  {recoveryStatus === 'generating' ? 'Generating…' : recoveryStatus === 'generated' ? 'Regenerate codes' : 'Generate codes'}
                </button>
              </div>
              {recoveryError && <div className="error-text">{recoveryError}</div>}
              {recoveryCodes && (
                <div style={{ background: 'var(--pitch)', padding: 12, borderRadius: 4, marginTop: 8 }}>
                  <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginBottom: 8 }}>
                    Save these codes somewhere safe. Each code can be used once if you lose access to your authenticator app.
                  </p>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    {recoveryCodes.map((code, idx) => (
                      <div key={idx} className="mono" style={{ fontSize: 14, background: 'rgba(243,245,236,0.05)', padding: '6px 8px', borderRadius: 4 }}>
                        {code}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
