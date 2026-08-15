'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Rule = { id: string; type: 'global_trial' | 'promo_window'; trialDays: number | null; startAt: string | null; endAt: string | null; isActive: boolean };
type Grant = { id: string; expiresAt: string | null; user: { email: string }; post: { title: string } | null };

export default function FreeAccessPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [loading, setLoading] = useState(true);

  const [ruleType, setRuleType] = useState<'global_trial' | 'promo_window'>('global_trial');
  const [trialDays, setTrialDays] = useState(7);
  const [startAt, setStartAt] = useState('');
  const [endAt, setEndAt] = useState('');
  const [ruleError, setRuleError] = useState<string | null>(null);
  const [savingRule, setSavingRule] = useState(false);

  const [grantEmail, setGrantEmail] = useState('');
  const [grantError, setGrantError] = useState<string | null>(null);
  const [savingGrant, setSavingGrant] = useState(false);

  function load() {
    setLoading(true);
    Promise.all([apiJson<Rule[]>('/api/admin/free-access-rules'), apiJson<Grant[]>('/api/admin/complimentary-access')])
      .then(([r, g]) => {
        setRules(r);
        setGrants(g);
      })
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function createRule(e: React.FormEvent) {
    e.preventDefault();
    setSavingRule(true);
    setRuleError(null);
    try {
      const body =
        ruleType === 'global_trial'
          ? { type: 'global_trial', trialDays: Number(trialDays) }
          : { type: 'promo_window', startAt: new Date(startAt).toISOString(), endAt: new Date(endAt).toISOString() };

      await apiJson('/api/admin/free-access-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      load();
    } catch (err) {
      setRuleError((err as Error).message);
    } finally {
      setSavingRule(false);
    }
  }

  async function toggleRule(rule: Rule) {
    await apiJson(`/api/admin/free-access-rules/${rule.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !rule.isActive }),
    });
    load();
  }

  async function grantAccess(e: React.FormEvent) {
    e.preventDefault();
    setSavingGrant(true);
    setGrantError(null);
    try {
      // Look up the user by email first — the API takes a userId, and
      // asking the admin to know a UUID by heart would be unreasonable.
      const users = await apiJson<{ id: string; email: string }[]>(`/api/admin/users`);
      const match = users.find((u) => u.email.toLowerCase() === grantEmail.toLowerCase());
      if (!match) throw new Error(`No user found with email ${grantEmail}`);

      await apiJson('/api/admin/complimentary-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: match.id }),
      });
      setGrantEmail('');
      load();
    } catch (err) {
      setGrantError((err as Error).message);
    } finally {
      setSavingGrant(false);
    }
  }

  async function revokeGrant(id: string) {
    if (!confirm('Revoke this complimentary access?')) return;
    await apiJson(`/api/admin/complimentary-access/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 8 }}>Free access</h1>
      <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 24 }}>
        PRD Section 5 — global trial days, promo windows, and per-user complimentary access, all bypass the paywall independent of a subscription.
      </p>

      <div className="admin-grid-2col" style={{ marginBottom: 24 }}>
        <div className="card">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Trial & promo rules</h2>
          {loading ? <p>Loading…</p> : rules.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>No rules configured.</p>
          ) : (
            <div className="table-container">
              <table style={{ width: '100%', minWidth: 440, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                    <th style={{ padding: '6px 0' }}>Type</th>
                    <th>Details</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rules.map((r) => (
                    <tr key={r.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                      <td style={{ padding: '6px 0' }}>{r.type === 'global_trial' ? 'Global trial' : 'Promo window'}</td>
                      <td>
                        {r.type === 'global_trial'
                          ? `${r.trialDays} days from signup`
                          : `${new Date(r.startAt!).toLocaleDateString()} → ${new Date(r.endAt!).toLocaleDateString()}`}
                      </td>
                      <td style={{ color: r.isActive ? 'var(--floodlight)' : 'var(--chalk-muted)' }}>{r.isActive ? 'Active' : 'Inactive'}</td>
                      <td style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => toggleRule(r)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>
                          {r.isActive ? 'Disable' : 'Enable'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={createRule} className="card">
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>New rule</h2>
          <div className="field">
            <label htmlFor="ruleType">Type</label>
            <select
              id="ruleType"
              value={ruleType}
              onChange={(e) => setRuleType(e.target.value as any)}
              style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '12px 14px', color: 'var(--chalk)' }}
            >
              <option value="global_trial">Global trial (new signups)</option>
              <option value="promo_window">Promo window (everyone, dated)</option>
            </select>
          </div>

          {ruleType === 'global_trial' ? (
            <div className="field">
              <label htmlFor="trialDays">Trial days</label>
              <input id="trialDays" type="number" min={1} required value={trialDays} onChange={(e) => setTrialDays(Number(e.target.value))} />
            </div>
          ) : (
            <>
              <div className="field">
                <label htmlFor="startAt">Starts</label>
                <input id="startAt" type="datetime-local" required value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="endAt">Ends</label>
                <input id="endAt" type="datetime-local" required value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </div>
            </>
          )}

          {ruleError && <div className="error-text">{ruleError}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={savingRule}>
            {savingRule ? 'Creating…' : 'Create rule'}
          </button>
        </form>
      </div>

      <div className="admin-grid-2col">
        <div className="card">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Complimentary access grants</h2>
          {grants.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>No grants yet.</p>
          ) : (
            <div className="table-container">
              <table style={{ width: '100%', minWidth: 440, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                    <th style={{ padding: '6px 0' }}>User</th>
                    <th>Scope</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {grants.map((g) => (
                    <tr key={g.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                      <td style={{ padding: '6px 0' }}>{g.user.email}</td>
                      <td>{g.post ? g.post.title : 'Full access'}</td>
                      <td style={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <button onClick={() => revokeGrant(g.id)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12, color: 'var(--card-red)' }}>
                          Revoke
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={grantAccess} className="card">
          <h2 style={{ fontSize: 16, marginBottom: 16 }}>Grant full access</h2>
          <div className="field">
            <label htmlFor="grantEmail">User email</label>
            <input id="grantEmail" type="email" required value={grantEmail} onChange={(e) => setGrantEmail(e.target.value)} placeholder="user@example.com" />
          </div>
          {grantError && <div className="error-text">{grantError}</div>}
          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={savingGrant}>
            {savingGrant ? 'Granting…' : 'Grant access'}
          </button>
        </form>
      </div>
    </>
  );
}
