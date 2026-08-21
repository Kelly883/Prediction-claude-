'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiJson } from '@/lib/api-client';
import { Shield, Lock, CheckCircle2 } from 'lucide-react';

type Step = 'account' | 'totp' | 'success';

export default function SuperAdminSetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>('account');
  const [bootstrapId, setBootstrapId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [secret, setSecret] = useState('');
  const [otpauthUri, setOtpauthUri] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    apiJson<{ exists: boolean }>('/api/superadmin/setup')
      .then((data) => {
        if (cancelled) return;
        if (data.exists) {
          router.replace('/404');
        } else {
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [router]);

  async function startSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    if (password.length < 12) {
      setError('Password must be at least 12 characters');
      return;
    }
    try {
      const res = await apiJson<{ id: string; secret: string; otpauthUri: string }>('/api/superadmin/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });
      setBootstrapId(res.id);
      setSecret(res.secret);
      setOtpauthUri(res.otpauthUri);
      setStep('totp');
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function completeSetup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      const res = await apiJson<{ ok: boolean; user: { id: string; email: string } }>(
        `/api/superadmin/setup/verify?id=${encodeURIComponent(bootstrapId)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        }
      );
      if (res.ok) {
        setStep('success');
        setTimeout(() => router.replace('/admin'), 2000);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="section" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="card" style={{ width: 420, maxWidth: '100%' }}>
          <p style={{ color: 'var(--chalk-muted)' }}>Checking system state…</p>
        </div>
      </div>
    );
  }

  if (step === 'success') {
    return (
      <div className="section" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <div className="card" style={{ width: 420, maxWidth: '100%', textAlign: 'center' }}>
          <CheckCircle2 size={48} style={{ color: '#4ade80', marginBottom: 16 }} />
          <h1 className="display" style={{ fontSize: 26, marginBottom: 12 }}>Superadmin account created</h1>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>
            Your account is active. Redirecting to the admin dashboard…
          </p>
          <div style={{ fontSize: 13, color: 'var(--chalk-muted)' }}>
            Log in at <strong>{email}</strong> with your password and authenticator app.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="section" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
      <div className="card" style={{ width: 420, maxWidth: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <Shield size={22} style={{ color: 'var(--floodlight)' }} />
          <div>
            <div className="eyebrow" style={{ marginBottom: 4 }}>One-time setup</div>
            <h1 className="display" style={{ fontSize: 24, marginBottom: 0 }}>Create Superadmin</h1>
          </div>
        </div>

        {step === 'account' && (
          <form onSubmit={startSetup} className="space-y-4">
            <div className="field">
              <label htmlFor="name">Full Name</label>
              <input id="name" required value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Admin" className="admin-input" />
            </div>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@example.com" className="admin-input" />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input id="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 12 chars, upper + lower + number" className="admin-input" />
            </div>
            <div className="field">
              <label htmlFor="confirmPassword">Confirm Password</label>
              <input id="confirmPassword" type="password" required value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Repeat password" className="admin-input" />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }}>Continue to 2FA Setup</button>
          </form>
        )}

        {step === 'totp' && (
          <form onSubmit={completeSetup} className="space-y-4">
            <div style={{ padding: 12, background: 'rgba(245,179,53,0.1)', border: '1px solid rgba(245,179,53,0.3)', borderRadius: 10, fontSize: 13, color: 'var(--chalk-muted)' }}>
              <strong style={{ color: 'var(--floodlight)' }}>Save this secret now.</strong> You will need it to set up your authenticator app. After this step it will not be shown again.
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.1)', borderRadius: 10 }}>
              <Lock size={16} style={{ color: 'var(--chalk-muted)' }} />
              <code style={{ fontSize: 12, wordBreak: 'break-all', color: 'white' }}>{secret}</code>
            </div>

            {otpauthUri && (
              <div style={{ textAlign: 'center' }}>
                <img
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(otpauthUri)}`}
                  alt="2FA QR Code"
                  style={{ borderRadius: 10, border: '1px solid rgba(243,245,236,0.1)' }}
                />
                <div style={{ fontSize: 12, color: 'var(--chalk-muted)', marginTop: 8 }}>
                  Scan with Google Authenticator, Authy, or similar
                </div>
              </div>
            )}

            <div className="field">
              <label htmlFor="code">Verification Code</label>
              <input id="code" inputMode="numeric" required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="123456" className="admin-input" style={{ textAlign: 'center', fontSize: 20, letterSpacing: 6 }} />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={creating}>
              {creating ? 'Creating account…' : 'Complete Setup'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
