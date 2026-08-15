'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';

type Plan = {
  id: string;
  name: string;
  durationDays: number;
  priceNGN: string;
  priceUSDOverride: string | null;
  isActive: boolean;
};

type FormState = {
  name: string;
  durationDays: number;
  priceNGN: string;
  priceUSDOverride: string;
};

const emptyForm: FormState = {
  name: '',
  durationDays: 30,
  priceNGN: '',
  priceUSDOverride: '',
};

export default function AdminPlansPage() {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function loadPlans() {
    apiJson<Plan[]>('/api/plans')
      .then(setPlans)
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    loadPlans();
  }, []);

  function startEdit(plan: Plan) {
    setEditingId(plan.id);
    setForm({
      name: plan.name,
      durationDays: plan.durationDays,
      priceNGN: plan.priceNGN,
      priceUSDOverride: plan.priceUSDOverride ?? '',
    });
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const payload = {
        name: form.name,
        durationDays: Number(form.durationDays),
        priceNGN: Number(form.priceNGN),
        priceUSDOverride: form.priceUSDOverride ? Number(form.priceUSDOverride) : undefined,
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
      loadPlans();
    } catch (err) {
      setError((err as Error).message || 'Failed to save plan.');
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(plan: Plan) {
    try {
      await apiJson(`/api/admin/plans/${plan.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isActive: !plan.isActive }),
      });
      loadPlans();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  const activePlansCount = plans.filter((p) => p.isActive).length;

  return (
    <div className="admin-plans-wrap">
      {/* Header */}
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
          <span className="admin-plans-active-badge">{activePlansCount} Active</span>
        </div>

        {loading ? (
          <div className="admin-plan-card" style={{ textAlign: 'center', color: '#85a694' }}>
            Loading plans…
          </div>
        ) : plans.length === 0 ? (
          <div className="admin-plan-card" style={{ textAlign: 'center', color: '#85a694', padding: '32px 20px' }}>
            No plans configured yet. Create your first plan below.
          </div>
        ) : (
          plans.map((p) => (
            <div key={p.id} className="admin-plan-card">
              <div className="admin-plan-card-main">
                <div className="admin-plan-crown-box">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M2 4l3 12h14l3-12-6 7-4-5-4 5-6-7z" />
                    <circle cx="12" cy="19" r="1" />
                  </svg>
                </div>

                <div className="admin-plan-body">
                  <div className="admin-plan-title-row">
                    <div className="admin-plan-title-left">
                      <span className="admin-plan-name">{p.name}</span>
                      <span className={`admin-plan-status-pill ${!p.isActive ? 'admin-plan-status-pill-inactive' : ''}`}>
                        {p.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                    <button type="button" className="admin-user-menu-btn" aria-label="More options">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <circle cx="12" cy="12" r="1" />
                        <circle cx="12" cy="5" r="1" />
                        <circle cx="12" cy="19" r="1" />
                      </svg>
                    </button>
                  </div>

                  <div className="admin-plan-meta">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <circle cx="12" cy="12" r="10" />
                      <polyline points="12 6 12 12 16 14" />
                    </svg>
                    <span>{p.durationDays} Days</span>
                  </div>

                  <div className="admin-plan-price-val">
                    ₦{Number(p.priceNGN).toLocaleString('en-NG')}
                    {p.priceUSDOverride && (
                      <span style={{ fontSize: 14, color: '#85a694', marginLeft: 10, fontWeight: 500 }}>
                        (${Number(p.priceUSDOverride).toFixed(2)})
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="admin-plan-actions-grid">
                <button type="button" onClick={() => startEdit(p)} className="admin-plan-btn-edit">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
                  </svg>
                  <span>Edit</span>
                </button>

                <button
                  type="button"
                  onClick={() => toggleActive(p)}
                  className={p.isActive ? 'admin-plan-btn-deactivate' : 'admin-plan-btn-activate'}
                >
                  {p.isActive ? (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                      <span>Deactivate</span>
                    </>
                  ) : (
                    <>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>Activate</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))
        )}
      </section>

      {/* Create / Edit Plan Form Section */}
      <section className="admin-plan-form-card">
        <h2 className="admin-plan-form-title">
          <span style={{ color: '#f5b335' }}>✨</span>
          <span>{editingId ? 'Edit Plan' : 'Create New Plan'}</span>
        </h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {error && (
            <div style={{ color: '#f87171', fontSize: 13, background: 'rgba(248,113,113,0.1)', padding: '10px 14px', borderRadius: 10 }}>
              {error}
            </div>
          )}

          <div className="admin-form-group">
            <label htmlFor="plan-name" className="admin-form-label">
              Plan Name
            </label>
            <input
              id="plan-name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Daily VIP Pass, Weekend Bank"
              className="admin-text-input"
            />
          </div>

          <div className="admin-form-row-2col">
            <div className="admin-form-group">
              <label htmlFor="plan-duration" className="admin-form-label">
                Duration (Days)
              </label>
              <div className="admin-input-box">
                <svg className="admin-input-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <input
                  id="plan-duration"
                  type="number"
                  required
                  min="1"
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
                <span className="admin-input-icon" style={{ fontSize: 15, fontWeight: 700 }}>
                  ₦
                </span>
                <input
                  id="plan-price-ngn"
                  type="number"
                  required
                  min="0"
                  step="0.01"
                  value={form.priceNGN}
                  onChange={(e) => setForm({ ...form, priceNGN: e.target.value })}
                  placeholder="e.g. 5000"
                  className="admin-text-input admin-text-input-with-icon"
                />
              </div>
            </div>
          </div>

          <div className="admin-form-group">
            <label htmlFor="plan-price-usd" className="admin-form-label">
              Fixed USD Price ($) (Optional)
            </label>
            <div className="admin-input-box">
              <span className="admin-input-icon" style={{ fontSize: 16, fontWeight: 700 }}>
                $
              </span>
              <input
                id="plan-price-usd"
                type="number"
                min="0"
                step="0.01"
                value={form.priceUSDOverride}
                onChange={(e) => setForm({ ...form, priceUSDOverride: e.target.value })}
                placeholder="Leave blank to auto-convert NGN amount"
                className="admin-text-input admin-text-input-with-icon"
              />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
            <button type="submit" disabled={saving} className="admin-submit-btn">
              <span>+</span>
              <span>{saving ? 'Saving…' : editingId ? 'Update Plan' : 'Create Plan'}</span>
            </button>

            {editingId && (
              <button type="button" onClick={cancelEdit} className="admin-cancel-btn">
                Cancel Editing
              </button>
            )}
          </div>
        </form>
      </section>
    </div>
  );
}
