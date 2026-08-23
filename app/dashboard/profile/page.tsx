'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Me = { id: string; name: string; email: string; phone: string | null; country: string; role: 'admin' | 'user' | 'superadmin' };

export default function ProfilePage() {
  const [me, setMe] = useState<Me | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiJson<Me>('/api/me')
      .then((data) => {
        setMe(data);
        setName(data.name);
        setPhone(data.phone ?? '');
      })
      .finally(() => setLoading(false));
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      await apiJson('/api/me', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, phone: phone || null }),
      });
      setSaved(true);
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
                <label>Email</label>
                <div style={{ padding: '12px 0', color: 'var(--chalk-muted)' }}>{me?.email} (contact support to change)</div>
              </div>
              <div className="field">
                <label htmlFor="phone">Phone</label>
                <input id="phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+234..." />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save changes'}
              </button>
            </form>
          </div>
    </div>
  );
}
