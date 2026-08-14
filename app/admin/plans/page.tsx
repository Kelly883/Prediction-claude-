'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { 
  Crown, 
  Sparkles, 
  Pencil, 
  X, 
  Check, 
  Calendar, 
  Banknote, 
  DollarSign, 
  Lock, 
  ChevronDown, 
  Clock, 
  MoreVertical,
  Plus,
  ShieldAlert,
  Zap
} from 'lucide-react';

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
    // Scroll form into view
    const formEl = document.getElementById('plan-form-section');
    if (formEl) {
      formEl.scrollIntoView({ behavior: 'smooth' });
    }
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

  const activeCount = plans.filter((p) => p.isActive).length;

  return (
    <div className="admin-plans-wrap">
      {/* Page Header */}
      <header className="admin-plans-header">
        <h1 className="admin-plans-title">Membership Plans</h1>
        <p className="admin-plans-subtitle">
          Configure subscriber pass durations, pricing in NGN, and optional USD rates.
        </p>
      </header>

      {/* Configured Plans Section */}
      <section className="admin-plans-section">
        <div className="admin-plans-section-top">
          <h2 className="admin-plans-section-heading">Configured Plans</h2>
          <span className="admin-plans-active-badge">
            {activeCount} Active
          </span>
        </div>

        {loading ? (
          <div className="p-8 text-center text-sm text-[#85a694]">
            Loading membership plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-2xl bg-[#102e20]/40">
            <Zap size={28} className="mx-auto mb-2 text-[#f5b335] opacity-80" />
            <p className="text-sm text-white font-medium">No plans configured yet</p>
            <p className="text-xs text-[#85a694] mt-1 max-w-sm mx-auto">
              Create your first plan below so visitors can purchase subscriptions.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {plans.map((p) => (
              <div key={p.id} className="admin-plan-card">
                <div className="admin-plan-card-main">
                  <div className="admin-plan-crown-box">
                    <Crown size={24} />
                  </div>
                  <div className="admin-plan-body">
                    <div className="admin-plan-title-row">
                      <div className="admin-plan-title-left">
                        <span className="admin-plan-name">{p.name}</span>
                        <span
                          className={`admin-plan-status-pill ${
                            !p.isActive ? 'admin-plan-status-pill-inactive' : ''
                          }`}
                        >
                          {p.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => startEdit(p)}
                        className="text-[#85a694] hover:text-white p-1 rounded transition-colors"
                        title="Options"
                      >
                        <MoreVertical size={18} />
                      </button>
                    </div>

                    <div className="admin-plan-meta">
                      <Clock size={14} className="text-[#85a694] shrink-0" />
                      <span>
                        {p.durationDays} Days • Scope: {p.accessScope === 'all' ? 'All VIP Predictions' : 'Category Only'}
                      </span>
                    </div>

                    <div className="admin-plan-price-val">
                      ₦{Number(p.priceNGN).toLocaleString()}
                    </div>
                  </div>
                </div>

                {/* Bottom Action Buttons */}
                <div className="admin-plan-actions-grid">
                  <button
                    type="button"
                    onClick={() => startEdit(p)}
                    className="admin-plan-btn-edit"
                  >
                    <Pencil size={15} />
                    <span>Edit</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => toggleActive(p)}
                    className={p.isActive ? 'admin-plan-btn-deactivate' : 'admin-plan-btn-activate'}
                  >
                    {p.isActive ? (
                      <>
                        <X size={15} />
                        <span>Deactivate</span>
                      </>
                    ) : (
                      <>
                        <Check size={15} />
                        <span>Activate</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Create / Edit Plan Form Section */}
      <section id="plan-form-section" className="admin-plan-form-card">
        <h2 className="admin-plan-form-title">
          <Sparkles size={20} className="text-[#f5b335]" />
          <span>{editingId ? 'Edit Membership Plan' : 'Create New Plan'}</span>
        </h2>

        <form onSubmit={submit} className="flex flex-col gap-4">
          {/* Plan Name */}
          <div className="admin-form-group">
            <label htmlFor="plan-name" className="admin-form-label">
              Plan Name
            </label>
            <div className="admin-input-box">
              <input
                id="plan-name"
                required
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Daily VIP Pass, Weekend Bank"
                className="admin-text-input"
              />
            </div>
          </div>

          {/* Duration & Price Row */}
          <div className="admin-form-row-2col">
            <div className="admin-form-group">
              <label htmlFor="plan-duration" className="admin-form-label">
                Duration (Days)
              </label>
              <div className="admin-input-box">
                <Calendar size={18} className="admin-input-icon" />
                <input
                  id="plan-duration"
                  type="number"
                  min={1}
                  required
                  value={form.durationDays}
                  onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })}
                  className="admin-text-input admin-text-input-with-icon"
                />
              </div>
            </div>

            <div className="admin-form-group">
              <label htmlFor="plan-price-ngn" className="admin-form-label">
                Price (NGN ₦)
              </label>
              <div className="admin-input-box">
                <Banknote size={18} className="admin-input-icon" />
                <input
                  id="plan-price-ngn"
                  type="number"
                  min={100}
                  required
                  value={form.priceNGN}
                  onChange={(e) => setForm({ ...form, priceNGN: e.target.value })}
                  placeholder="e.g. 5000"
                  className="admin-text-input admin-text-input-with-icon"
                />
              </div>
            </div>
          </div>

          {/* Fixed USD Price (Optional) */}
          <div className="admin-form-group">
            <label htmlFor="plan-price-usd" className="admin-form-label">
              Fixed USD Price ($) (Optional)
            </label>
            <div className="admin-input-box">
              <DollarSign size={18} className="admin-input-icon" />
              <input
                id="plan-price-usd"
                type="number"
                step="0.01"
                min={0.5}
                value={form.priceUSDOverride}
                onChange={(e) => setForm({ ...form, priceUSDOverride: e.target.value })}
                placeholder="Leave blank to auto-convert NGN amount"
                className="admin-text-input admin-text-input-with-icon"
              />
            </div>
          </div>

          {/* Access Scope */}
          <div className="admin-form-group">
            <label htmlFor="plan-access-scope" className="admin-form-label">
              Access Scope
            </label>
            <div className="admin-select-wrapper">
              <Lock size={18} className="admin-input-icon" />
              <select
                id="plan-access-scope"
                value={form.accessScope}
                onChange={(e) => setForm({ ...form, accessScope: e.target.value as 'all' | 'category' })}
                className="admin-select-input"
              >
                <option value="all">All VIP Predictions & Booking Codes</option>
                <option value="category">Category Only</option>
              </select>
              <ChevronDown size={18} className="admin-select-chevron" />
            </div>
          </div>

          {error && (
            <div className="p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-2">
              <ShieldAlert size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit Action */}
          <div className="flex flex-col gap-2 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="admin-submit-btn"
            >
              {saving ? (
                'Saving…'
              ) : editingId ? (
                <>
                  <Check size={18} />
                  <span>Save Changes</span>
                </>
              ) : (
                <>
                  <Plus size={18} />
                  <span>Create Plan</span>
                </>
              )}
            </button>

            {editingId && (
              <button
                type="button"
                onClick={cancelEdit}
                className="admin-cancel-btn"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
