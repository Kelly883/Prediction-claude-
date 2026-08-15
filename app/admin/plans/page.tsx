'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

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
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 24 }}>Plans</h1>

      <div className="admin-grid-2col">
        <div className="card">
          {loading ? (
            <p>Loading…</p>
          ) : (
            <div className="table-container">
              <table style={{ width: '100%', minWidth: 520, borderCollapse: 'collapse', fontSize: 14 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                    <th style={{ padding: '8px 0' }}>Name</th>
                    <th>Duration</th>
                    <th>Price (NGN)</th>
                    <th>USD override</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {plans.map((p) => (
                    <tr key={p.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)', background: editingId === p.id ? 'var(--pitch)' : undefined }}>
                      <td style={{ padding: '8px 0' }}>{p.name}</td>
                      <td>{p.durationDays}d</td>
                      <td className="mono">₦{Number(p.priceNGN).toLocaleString()}</td>
                      <td className="mono">{p.priceUSDOverride ? `$${Number(p.priceUSDOverride).toFixed(2)}` : '—'}</td>
                      <td>{p.accessScope}</td>
                      <td style={{ color: p.isActive ? 'var(--floodlight)' : 'var(--chalk-muted)' }}>{p.isActive ? 'Active' : 'Inactive'}</td>
                      <td style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button onClick={() => startEdit(p)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>Edit</button>
                        <button onClick={() => toggleActive(p)} className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 12 }}>
                          {p.isActive ? 'Deactivate' : 'Activate'}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <form onSubmit={submit} className="card">
              <h2 style={{ fontSize: 16, marginBottom: 16 }}>{editingId ? 'Edit plan' : 'New plan'}</h2>
              <div className="field">
                <label htmlFor="name">Name</label>
                <input id="name" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="VIP Monthly" />
              </div>
              <div className="field">
                <label htmlFor="duration">Duration (days)</label>
                <input id="duration" type="number" required value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: Number(e.target.value) })} />
              </div>
              <div className="field">
                <label htmlFor="price">Price (NGN)</label>
                <input id="price" type="number" required value={form.priceNGN} onChange={(e) => setForm({ ...form, priceNGN: e.target.value })} placeholder="4500" />
              </div>
              <div className="field">
                <label htmlFor="usdOverride">Fixed USD price (optional)</label>
                <input id="usdOverride" type="number" step="0.01" value={form.priceUSDOverride} onChange={(e) => setForm({ ...form, priceUSDOverride: e.target.value })} placeholder="Leave blank to auto-convert via FX" />
              </div>
              <div className="field">
                <label htmlFor="scope">Access scope</label>
                <select
                  id="scope"
                  value={form.accessScope}
                  onChange={(e) => setForm({ ...form, accessScope: e.target.value as 'all' | 'category' })}
                  style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '12px 14px', color: 'var(--chalk)' }}
                >
                  <option value="all">All predictions</option>
                  <option value="category">Category-based</option>
                </select>
              </div>
              {error && <div className="error-text">{error}</div>}
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="submit" className="btn btn-primary" style={{ flex: 1 }} disabled={saving}>
                  {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create plan'}
                </button>
                {editingId && (
                  <button type="button" onClick={cancelEdit} className="btn btn-ghost">Cancel</button>
                )}
              </div>
            </form>
          </div>
    </>
  );
}
