'use client';

import { useEffect, useState } from 'react';
import { Shield, Lock } from 'lucide-react';

type PermissionSchema = {
  permissions: string[];
  labels: Record<string, string>;
  groups: { label: string; permissions: string[] }[];
  navMapping: Record<string, string>;
};

export default function AdminPermissionsPage() {
  const [schema, setSchema] = useState<PermissionSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/admin/permissions/schema')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load permission schema');
        return res.json();
      })
      .then(setSchema)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <div className="admin-loading">Loading permission catalog…</div>;
  }

  if (error) {
    return (
      <div className="admin-empty-state">
        <Shield size={28} className="text-red-400" style={{ marginBottom: 8 }} />
        <p className="admin-empty-state-title">Failed to load permissions</p>
        <p className="admin-empty-state-desc">{error}</p>
      </div>
    );
  }

  if (!schema) return null;

  return (
    <div className="space-y-6">
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Access Control</div>
        <h1 className="admin-page-title">Permission Catalog</h1>
        <p className="admin-page-subtitle">Reference for all available permissions and their admin power classification.</p>
        <div className="admin-underline" />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {schema.groups.map((group) => (
          <div key={group.label} className="card">
            <h2 className="admin-card-title" style={{ marginBottom: 16 }}>{group.label}</h2>
            <div className="space-y-2">
              {group.permissions.map((perm) => {
                const label = schema.labels[perm] || perm;
                const isAdminPower = perm.startsWith('admin.');
                return (
                  <div
                    key={perm}
                    className="flex items-center justify-between p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.08)]"
                  >
                    <div className="flex items-center gap-2">
                      {isAdminPower ? (
                        <Lock size={14} className="text-[var(--accent-2)]" />
                      ) : (
                        <Shield size={14} className="text-[#85a694]" />
                      )}
                      <span className="text-sm text-white">{label}</span>
                    </div>
                    <code className="text-xs text-[var(--chalk-muted)] font-mono">{perm}</code>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
