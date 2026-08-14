'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { Zap, Plus, Edit2, Check, X, ShieldAlert, Sparkles } from 'lucide-react';

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceNGN: string;
  priceUSDOverride: string | null;
  accessScope: 'all' | 'category';
  isActive: boolean;
};

type FormState = {
  name: string;
  durationDays: number;
  priceNGN: string;
  priceUSDOverride: string;
  accessScope: 'all' | 'category';
};

const emptyForm: FormState = { name: '', durationDays: 30, priceNGN: '', priceUSDOverride: '', accessScope: 'all' };

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    apiJson<Plan[]>('/api/plans').then(setPlans).finally(() => setLoading(false));
  }

  useEffect(load, []);

  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      durationDays: plan.durationDays,
      priceNGN: plan.priceNGN,
      priceUSDOverride: plan.priceUSDOverride ?? '',
      accessScope: plan.accessScope,
    });
    // Scroll form into view on mobile
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name,
        durationDays: Number(form.durationDays),
        priceNGN: Number(form.priceNGN),
        priceUSDOverride: form.priceUSDOverride ? Number(form.priceUSDOverride) : undefined,
        accessScope: form.accessScope,
      };

      if (editingId) {
        await apiJson(`/api/admin/plans/${editingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      } else {
        await apiJson('/api/admin/plans', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
      }
      cancelEdit();
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(plan: Plan) {
    await apiJson(`/api/admin/plans/${plan.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive: !plan.isActive }),
    });
    load();
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white">Membership Plans</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Configure subscriber pass durations, pricing in NGN, and optional USD rates.
          </p>
        </div>
      </div>

      <div className="admin-grid-2col">
        {/* Plans List Column */}
        <div className="space-y-4">
          <div className="card p-4 sm:p-5">
            <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
              <span>Configured Plans ({plans.length})</span>
              <span className="text-xs text-[var(--chalk-muted)] font-normal">Auto-synced with checkout</span>
            </h2>

            {loading ? (
              <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
                Loading membership plans…
              </div>
            ) : plans.length === 0 ? (
              <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
                <Zap size={28} className="mx-auto mb-2 text-[var(--floodlight)] opacity-80" />
                <p className="text-sm text-white font-medium">No plans created yet</p>
                <p className="text-xs text-[var(--chalk-muted)] mt-1 max-w-sm mx-auto">
                  Create your first plan using the form on the right so visitors can subscribe.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Mobile Cards / Desktop Rows */}
                {plans.map((p) => (
                  <div
                    key={p.id}
                    className={`p-4 rounded-lg border transition-all ${
                      editingId === p.id
                        ? 'border-[var(--floodlight)] bg-[rgba(245,179,53,0.06)]'
                        : 'border-[rgba(243,245,236,0.1)] bg-[var(--pitch)]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-base text-white">{p.name}</span>
                          <span
                            className={`px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider rounded ${
                              p.isActive
                                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                                : 'bg-zinc-700/40 text-zinc-400 border border-zinc-700'
                            }`}
                          >
                            {p.isActive ? 'Active' : 'Inactive'}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] mt-1.5 flex-wrap font-mono">
                          <span>⏱ {p.durationDays} Days</span>
                          <span>•</span>
                          <span>Scope: {p.accessScope === 'all' ? 'All Predictions' : 'Category Only'}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="font-mono text-lg font-bold text-[var(--floodlight)]">
                          ₦{Number(p.priceNGN).toLocaleString()}
                        </div>
                        {p.priceUSDOverride && (
                          <div className="font-mono text-xs text-[var(--chalk-muted)]">
                            ${Number(p.priceUSDOverride).toFixed(2)} USD
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-end gap-2 mt-4 pt-3 border-t border-[rgba(243,245,236,0.06)]">
                      <button
                        onClick={() => startEdit(p)}
                        className="btn btn-ghost text-xs py-1.5 px-3 inline-flex items-center gap-1.5"
                      >
                        <Edit2 size={12} />
                        <span>Edit</span>
                      </button>
                      <button
                        onClick={() => toggleActive(p)}
                        className={`btn btn-ghost text-xs py-1.5 px-3 inline-flex items-center gap-1.5 ${
                          p.isActive ? 'text-amber-300 hover:text-amber-200' : 'text-emerald-400 hover:text-emerald-300'
                        }`}
                      >
                        {p.isActive ? <X size={12} /> : <Check size={12} />}
                        <span>{p.isActive ? 'Deactivate' : 'Activate'}</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Plan Form Column */}
        <div>
          <form onSubmit={submit} className="card p-4 sm:p-5 sticky top-24">
            <h2 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
              <Sparkles size={16} className="text-[var(--floodlight)]" />
              <span>{editingId ? 'Edit Membership Plan' : 'Create New Plan'}</span>
            </h2>

            <div className="space-y-4">
              <div className="field mb-0">
                <label htmlFor="name" className="text-xs text-[var(--chalk-muted)] font-medium">Plan Name</label>
                <input
                  id="name"
                  required
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Daily VIP Pass, Weekend Banker"
                  className="w-full"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="field mb-0">
                  <label htmlFor="duration" className="text-xs text-[var(--chalk-muted)] font-medium">Duration (Days)</label>
                  <input
                    id="duration"
                    type="number"
                    min={1}
                    required
                    value={form.durationDays}
                    onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })}
                    className="w-full"
                  />
                </div>

                <div className="field mb-0">
                  <label htmlFor="price" className="text-xs text-[var(--chalk-muted)] font-medium">Price (NGN ₦)</label>
                  <input
                    id="price"
                    type="number"
                    min={100}
                    required
                    value={form.priceNGN}
                    onChange={(e) => setForm({ ...form, priceNGN: e.target.value })}
                    placeholder="e.g. 5000"
                    className="w-full"
                  />
                </div>
              </div>

              <div className="field mb-0">
                <label htmlFor="usdOverride" className="text-xs text-[var(--chalk-muted)] font-medium">
                  Fixed USD Price ($) (Optional)
                </label>
                <input
                  id="usdOverride"
                  type="number"
                  step="0.01"
                  min={0.5}
                  value={form.priceUSDOverride}
                  onChange={(e) => setForm({ ...form, priceUSDOverride: e.target.value })}
                  placeholder="Leave blank to auto-convert NGN at live FX rate"
                  className="w-full"
                />
              </div>

              <div className="field mb-0">
                <label htmlFor="scope" className="text-xs text-[var(--chalk-muted)] font-medium">Access Scope</label>
                <select
                  id="scope"
                  value={form.accessScope}
                  onChange={(e) => setForm({ ...form, accessScope: e.target.value as 'all' | 'category' })}
                  className="w-full bg-[var(--pitch)] border border-[rgba(243,245,236,0.14)] rounded-md p-3 text-sm text-[var(--chalk)]"
                >
                  <option value="all">All VIP Predictions & Booking Codes</option>
                  <option value="category">Category-specific Only</option>
                </select>
              </div>

              {error && (
                <div className="p-3 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
                  <ShieldAlert size={14} className="shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="submit"
                  className="btn btn-primary flex-1 py-2.5 text-sm font-semibold inline-flex items-center justify-center gap-2"
                  disabled={saving}
                >
                  {saving ? (
                    'Saving…'
                  ) : editingId ? (
                    <>
                      <Check size={14} />
                      <span>Save Changes</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      <span>Create Plan</span>
                    </>
                  )}
                </button>
                {editingId && (
                  <button
                    type="button"
                    onClick={cancelEdit}
                    className="btn btn-ghost py-2.5 text-sm"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

