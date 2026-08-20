'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import { PERMISSIONS } from '@/lib/permissions';
import { Gift, ShieldAlert, Check, Plus, Trash2, Calendar, UserCheck } from 'lucide-react';

type Rule = { id: string; type: 'global_trial' | 'promo_window'; trialDays: number | null; startAt: string | null; endAt: string | null; isActive: boolean };
type Grant = { id: string; expiresAt: string | null; user: { email: string }; post: { title: string } | null };

export default function FreeAccessPage() {
  const canManageFreeAccess = useHasPermission(PERMISSIONS.pages.freeAccess);

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
      const users = await apiJson<{ id: string; email: string }[]>(`/api/admin/users`);
      const match = users.find((u) => u.email.toLowerCase() === grantEmail.toLowerCase());
      if (!match) throw new Error(`No registered user found with email ${grantEmail}`);

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
    if (!confirm('Revoke this complimentary access grant?')) return;
    await apiJson(`/api/admin/complimentary-access/${id}`, { method: 'DELETE' });
    load();
  }

  return (
    <div className="space-y-6">
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Free Access &amp; Promo Rules</div>
        <h1 className="admin-page-title">Free Access &amp; Promo Rules</h1>
        <p className="admin-page-subtitle">Configure global trial periods, scheduled promotional free windows, and manual VIP complimentary grants.</p>
        <div className="admin-underline" />
      </div>

      <div className="admin-grid-2col">
        <div className="card p-4 sm:p-5">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Configured Promo &amp; Trial Rules</h2>
            <span className="admin-card-subtitle">{rules.length} Rules</span>
          </div>

          {loading ? (
            <div className="admin-loading">Loading rules…</div>
          ) : rules.length === 0 ? (
            <div className="admin-empty-state">
              <Gift size={24} className="admin-empty-state-icon" />
              <p className="admin-empty-state-title">No trial or promo rules active</p>
              <p className="admin-empty-state-desc">Add a rule to give new users a free trial or schedule open viewing days.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {rules.map((r) => (
                <div
                  key={r.id}
                  className="p-3.5 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center justify-between gap-3 flex-wrap"
                >
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-white">
                        {r.type === 'global_trial' ? 'Global Signup Trial' : 'Promotional Window'}
                      </span>
                      <span
                        className={`admin-status-pill ${r.isActive ? 'admin-status-pill-success' : 'admin-status-pill-neutral'}`}
                      >
                        {r.isActive ? 'Active' : 'Disabled'}
                      </span>
                    </div>
                    <div className="text-xs text-[var(--chalk-muted)] mt-1 font-mono">
                      {r.type === 'global_trial'
                        ? `${r.trialDays} free days on new registration`
                        : `${new Date(r.startAt!).toLocaleDateString()} → ${new Date(r.endAt!).toLocaleDateString()}`}
                    </div>
                  </div>
                   <button
                     onClick={() => toggleRule(r)}
                     className="btn btn-ghost text-xs py-1.5 px-3"
                     disabled={!canManageFreeAccess}
                   >
                     {r.isActive ? 'Disable' : 'Enable'}
                   </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={createRule} className="card p-4 sm:p-5">
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <Plus size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>Create Trial / Promo Rule</h2>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="admin-form-group">
              <label htmlFor="ruleType" className="admin-form-label">Rule Type</label>
              <select
                id="ruleType"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as any)}
                className="admin-select"
              >
                <option value="global_trial">Global Trial (All New Signups)</option>
                <option value="promo_window">Dated Promo Window (Open To All)</option>
              </select>
            </div>

            {ruleType === 'global_trial' ? (
              <div className="admin-form-group">
                <label htmlFor="trialDays" className="admin-form-label">Trial Duration (Days)</label>
                <input
                  id="trialDays"
                  type="number"
                  min={1}
                  required
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                  className="admin-input"
                />
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                <div className="admin-form-group">
                  <label htmlFor="startAt" className="admin-form-label">Start Date &amp; Time</label>
                  <input
                    id="startAt"
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="admin-input"
                  />
                </div>
                <div className="admin-form-group">
                  <label htmlFor="endAt" className="admin-form-label">End Date &amp; Time</label>
                  <input
                    id="endAt"
                    type="datetime-local"
                    required
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="admin-input"
                  />
                </div>
              </div>
            )}

            {ruleError && <div className="admin-form-error"><span>{ruleError}</span></div>}

            <button type="submit" className="btn btn-primary w-full py-2.5 text-sm font-semibold" disabled={savingRule || !canManageFreeAccess}>
              {savingRule ? 'Saving…' : 'Activate Rule'}
            </button>
          </div>
        </form>
      </div>

      <div className="admin-grid-2col">
        <div className="card p-4 sm:p-5">
          <div className="admin-card-header">
            <h2 className="admin-card-title">Complimentary VIP Grants</h2>
            <span className="admin-card-subtitle">{grants.length} Grants</span>
          </div>

          {grants.length === 0 ? (
            <div className="admin-empty-state">
              <UserCheck size={24} className="admin-empty-state-icon" />
              <p className="admin-empty-state-title">No VIP grants active</p>
              <p className="admin-empty-state-desc">Grant individual subscribers lifetime or promotional complimentary access.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {grants.map((g) => (
                <div
                  key={g.id}
                  className="p-3.5 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex items-center justify-between gap-3 flex-wrap"
                >
                  <div>
                    <div className="font-semibold text-sm text-white">{g.user?.email}</div>
                    <div className="text-xs text-[var(--floodlight)] font-mono mt-0.5">
                      {g.post ? g.post.title : 'Full VIP Access Pass'}
                    </div>
                  </div>
                  <button
                    onClick={() => revokeGrant(g.id)}
                    className="btn btn-ghost text-xs py-1.5 px-3 text-red-400 hover:text-red-300"
                    disabled={!canManageFreeAccess}
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={grantAccess} className="card p-4 sm:p-5">
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <UserCheck size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>Grant Complimentary VIP</h2>
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="admin-form-group">
              <label htmlFor="grantEmail" className="admin-form-label">User Email Address</label>
              <input
                id="grantEmail"
                type="email"
                required
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                placeholder="subscriber@example.com"
                className="admin-input"
              />
            </div>

            {grantError && <div className="admin-form-error"><span>{grantError}</span></div>}

            <button type="submit" className="btn btn-primary w-full py-2.5 text-sm font-semibold" disabled={savingGrant || !canManageFreeAccess}>
              {savingGrant ? 'Granting Access…' : 'Grant Full VIP Access'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
