'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { Gift, ShieldAlert, Check, Plus, Trash2, Calendar, UserCheck } from 'lucide-react';

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
      {/* Header */}
      <div className="pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <h1 className="font-bold text-2xl sm:text-3xl text-white">Free Access & Promo Rules</h1>
        <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
          Configure global trial periods, scheduled promotional free windows, and manual VIP complimentary grants.
        </p>
      </div>

      {/* Rules Section */}
      <div className="admin-grid-2col">
        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
            <span>Configured Promo & Trial Rules</span>
            <span className="text-xs text-[var(--chalk-muted)] font-mono">{rules.length} Rules</span>
          </h2>

          {loading ? (
            <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">Loading rules…</div>
          ) : rules.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
              <Gift size={24} className="mx-auto mb-2 text-[var(--floodlight)] opacity-70" />
              <p className="text-sm text-white font-medium">No trial or promo rules active</p>
              <p className="text-xs text-[var(--chalk-muted)] mt-1">
                Add a rule to give new users a free trial or schedule open viewing days.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
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
                        className={`px-2 py-0.5 text-[9px] font-bold uppercase rounded ${
                          r.isActive
                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                            : 'bg-zinc-700/40 text-zinc-400 border border-zinc-700'
                        }`}
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
                  >
                    {r.isActive ? 'Disable' : 'Enable'}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rule Form */}
        <form onSubmit={createRule} className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Plus size={16} className="text-[var(--floodlight)]" />
            <span>Create Trial / Promo Rule</span>
          </h2>

          <div className="space-y-4">
            <div className="field mb-0">
              <label htmlFor="ruleType" className="text-xs text-[var(--chalk-muted)] font-medium">Rule Type</label>
              <select
                id="ruleType"
                value={ruleType}
                onChange={(e) => setRuleType(e.target.value as any)}
                className="w-full bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] rounded-md p-3 text-sm text-[var(--chalk)]"
              >
                <option value="global_trial">Global Trial (All New Signups)</option>
                <option value="promo_window">Dated Promo Window (Open To All)</option>
              </select>
            </div>

            {ruleType === 'global_trial' ? (
              <div className="field mb-0">
                <label htmlFor="trialDays" className="text-xs text-[var(--chalk-muted)] font-medium">Trial Duration (Days)</label>
                <input
                  id="trialDays"
                  type="number"
                  min={1}
                  required
                  value={trialDays}
                  onChange={(e) => setTrialDays(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="field mb-0">
                  <label htmlFor="startAt" className="text-xs text-[var(--chalk-muted)] font-medium">Start Date & Time</label>
                  <input
                    id="startAt"
                    type="datetime-local"
                    required
                    value={startAt}
                    onChange={(e) => setStartAt(e.target.value)}
                    className="w-full"
                  />
                </div>
                <div className="field mb-0">
                  <label htmlFor="endAt" className="text-xs text-[var(--chalk-muted)] font-medium">End Date & Time</label>
                  <input
                    id="endAt"
                    type="datetime-local"
                    required
                    value={endAt}
                    onChange={(e) => setEndAt(e.target.value)}
                    className="w-full"
                  />
                </div>
              </div>
            )}

            {ruleError && <div className="error-text">{ruleError}</div>}

            <button type="submit" className="btn btn-primary w-full py-2.5 text-sm font-semibold" disabled={savingRule}>
              {savingRule ? 'Saving…' : 'Activate Rule'}
            </button>
          </div>
        </form>
      </div>

      {/* Complimentary Access Section */}
      <div className="admin-grid-2col">
        <div className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
            <span>Complimentary VIP Grants</span>
            <span className="text-xs text-[var(--chalk-muted)] font-mono">{grants.length} Grants</span>
          </h2>

          {grants.length === 0 ? (
            <div className="p-6 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
              <UserCheck size={24} className="mx-auto mb-2 text-[var(--floodlight)] opacity-70" />
              <p className="text-sm text-white font-medium">No VIP grants active</p>
              <p className="text-xs text-[var(--chalk-muted)] mt-1">
                Grant individual subscribers lifetime or promotional complimentary access.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
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
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Grant Form */}
        <form onSubmit={grantAccess} className="card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <UserCheck size={16} className="text-[var(--floodlight)]" />
            <span>Grant Complimentary VIP</span>
          </h2>

          <div className="space-y-4">
            <div className="field mb-0">
              <label htmlFor="grantEmail" className="text-xs text-[var(--chalk-muted)] font-medium">User Email Address</label>
              <input
                id="grantEmail"
                type="email"
                required
                value={grantEmail}
                onChange={(e) => setGrantEmail(e.target.value)}
                placeholder="subscriber@example.com"
                className="w-full"
              />
            </div>

            {grantError && <div className="error-text">{grantError}</div>}

            <button type="submit" className="btn btn-primary w-full py-2.5 text-sm font-semibold" disabled={savingGrant}>
              {savingGrant ? 'Granting Access…' : 'Grant Full VIP Access'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

