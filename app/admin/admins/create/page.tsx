'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Shield, UserPlus, ArrowLeft, CheckCircle2, ShieldAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import { PERMISSIONS } from '@/lib/permissions';

const PERMISSION_OPTIONS: Record<string, string> = {
  'pages.overview': 'Overview',
  'pages.predictions': 'Predictions',
  'pages.plans': 'Plans',
  'pages.freeAccess': 'Free Access',
  'pages.users': 'Users',
  'pages.transactions': 'Transactions',
  'pages.auditLogs': 'Audit Logs',
  'pages.cms': 'CMS',
  'pages.security': 'Security',
  'admin.createAdmins': 'Create Admins',
  'admin.grantPermissions': 'Grant Permissions',
};

export default function CreateAdminPage() {
  const router = useRouter();
  const canCreateAdmins = useHasPermission(PERMISSIONS.admin.createAdmins);
  const [form, setForm] = useState({
    name: '',
    email: '',
    phone: '',
    country: 'Nigeria',
    password: '',
    permissions: [] as string[],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!canCreateAdmins) {
      router.replace('/admin');
    }
  }, [canCreateAdmins, router]);

  if (!canCreateAdmins) {
    return (
      <div className="admin-empty-state">
        <Shield size={28} className="text-red-400" style={{ marginBottom: 8 }} />
        <p className="admin-empty-state-title">Access denied</p>
        <p className="admin-empty-state-desc">You do not have permission to create admin accounts.</p>
      </div>
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiJson('/api/admin/admins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSuccess(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  if (success) {
    return (
      <div className="space-y-6">
        <div className="admin-page-header">
          <div className="admin-page-eyebrow">Admin Creation</div>
          <h1 className="admin-page-title">Admin Account Created</h1>
          <div className="admin-underline" />
        </div>
        <div className="card p-6 text-center">
          <CheckCircle2 size={48} style={{ color: '#4ade80', marginBottom: 16 }} />
          <h2 className="display" style={{ fontSize: 22, marginBottom: 12 }}>Admin account created successfully</h2>
          <p style={{ color: 'var(--chalk-muted)', marginBottom: 24 }}>
            The admin account for <strong>{form.email}</strong> has been created.
          </p>
          <div style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button onClick={() => { setSuccess(false); setForm({ name: '', email: '', phone: '', country: 'Nigeria', password: '', permissions: [] }); }} className="btn btn-primary">
              Create Another Admin
            </button>
            <Link href="/admin/users" className="btn btn-ghost">Back to Users</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Admin Creation</div>
        <h1 className="admin-page-title">Create Admin Account</h1>
        <p className="admin-page-subtitle">Create a new admin account with specific permissions. This action is logged and restricted to superadmin only.</p>
        <div className="admin-underline" />
      </div>

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="flex flex-col gap-5">
          <div className="admin-form-group">
            <label htmlFor="name" className="admin-form-label">Full Name *</label>
            <input
              id="name"
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Jane Admin"
              className="admin-input"
            />
          </div>

          <div className="admin-form-group">
            <label htmlFor="email" className="admin-form-label">Email Address *</label>
            <input
              id="email"
              type="email"
              required
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              placeholder="admin@example.com"
              className="admin-input"
            />
          </div>

          <div className="admin-form-row-2col">
            <div className="admin-form-group">
              <label htmlFor="phone" className="admin-form-label">Phone</label>
              <input
                id="phone"
                type="text"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+2348057531862"
                className="admin-input"
              />
            </div>

            <div className="admin-form-group">
              <label htmlFor="country" className="admin-form-label">Country</label>
              <input
                id="country"
                type="text"
                value={form.country}
                onChange={(e) => setForm({ ...form, country: e.target.value })}
                placeholder="Nigeria"
                className="admin-input"
              />
            </div>
          </div>

          <div className="admin-form-group">
            <label htmlFor="password" className="admin-form-label">Password</label>
            <input
              id="password"
              type="text"
              value={form.password}
              onChange={(e) => setForm({ ...form, password: e.target.value })}
              placeholder="Leave empty to generate a secure random password"
              className="admin-input"
            />
            <p className="text-xs text-[var(--chalk-muted)] mt-1">If left empty, a random password will be generated and shown after creation.</p>
          </div>

          <div className="admin-form-group">
            <label className="admin-form-label">Admin Permissions</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {Object.entries(PERMISSION_OPTIONS).map(([key, label]) => (
                <label key={key} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.permissions.includes(key)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setForm({ ...form, permissions: [...form.permissions, key] });
                      } else {
                        setForm({ ...form, permissions: form.permissions.filter((p) => p !== key) });
                      }
                    }}
                    style={{ accentColor: 'var(--floodlight)' }}
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {error && (
            <div className="admin-form-error">
              <ShieldAlert size={15} className="shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-[rgba(243,245,236,0.1)]">
            <Link href="/admin/users" className="btn btn-ghost py-2 px-4 text-sm">
              Cancel
            </Link>
            <button type="submit" disabled={saving} className="btn btn-primary py-2 px-5 text-sm font-semibold">
              {saving ? 'Creating…' : 'Create Admin'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
