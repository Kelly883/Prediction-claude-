'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { PERMISSIONS } from '@/lib/permissions';

type Me = { id: string; name: string; email: string; phone: string | null; country: string; role: 'admin' | 'user' | 'superadmin'; emailVerified: boolean; permissions: string[] };

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [emailSent, setEmailSent] = useState(false);

  useEffect(() => {
    apiJson<Me>('/api/me')
      .then((data) => {
        setMe(data);
        setName(data.name);
        setEmail(data.email);
        setPhone(data.phone ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  const canChangeEmail = !me?.emailVerified || (me.permissions || []).includes(PERMISSIONS.admin.changeEmail) || me?.role === 'superadmin';
  const isSuperadminChangingEmail = me?.role === 'superadmin' && me.emailVerified && email !== me.email;
  const showEmailField = !me?.emailVerified || canChangeEmail;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setEmailSent(false);
    setError(null);
    try {
      const payload: Record<string, string | null> = { name, phone: phone || null };
      if (showEmailField && email !== me?.email) {
        payload.email = email;
      }
      if (isSuperadminChangingEmail) {
        payload.twoFactorCode = twoFactorCode;
      }
      const res = await apiJson<{ id: string; email: string; emailVerified: boolean }>('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setSaved(true);
      if (res.emailVerified === false && payload.email) {
        setEmailSent(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <>
        <div className="container section">Loading…</div>
      </>
    );
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="eyebrow" style={{ marginBottom: 6 }}>PROFILE</div>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 24 }}>Your details</h1>

      <div className="card">
        <form onSubmit={save}>
          <div className="field">
            <label htmlFor="name">Full name</label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="email">Email</label>
            {showEmailField ? (
              <>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  required
                />
                <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginTop: 6 }}>
                  Changing your email will require re-verification.
                </p>
              </>
            ) : (
              <div style={{ padding: '12px 0', color: 'var(--chalk-muted)' }}>{me?.email} (verified — contact support to change)</div>
            )}
          </div>
          {isSuperadminChangingEmail && showEmailField && (
            <div className="field">
              <label htmlFor="twoFactorCode">Two-Factor Authentication Code</label>
              <input
                id="twoFactorCode"
                type="text"
                inputMode="numeric"
                value={twoFactorCode}
                onChange={(e) => setTwoFactorCode(e.target.value)}
                placeholder="123456"
                required
              />
              <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginTop: 6 }}>
                Enter a code from your authenticator app to confirm this change.
              </p>
            </div>
          )}
          <div className="field">
            <label htmlFor="phone">Phone</label>
            <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234..." />
          </div>
          {emailSent && (
            <div className="card" style={{ marginBottom: 16, borderColor: 'var(--floodlight)', padding: 12, fontSize: 13 }}>
              Verification email sent. Please check your inbox.
            </div>
          )}
          {error && <div className="error-text">{error}</div>}
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
          </button>
        </form>
      </div>
    </div>
  );
}
