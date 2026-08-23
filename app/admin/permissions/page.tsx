'use client';

import { useEffect, useState, useMemo } from 'react';
import { Shield, Lock, Search, X } from 'lucide-react';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import { PERMISSIONS } from '@/lib/permissions';

type PermissionSchema = {
  permissions: string[];
  labels: Record<string, string>;
  groups: { label: string; permissions: string[] }[];
  navMapping: Record<string, string>;
};

type PermissionEntry = {
  key: string;
  label: string;
  group: string;
  isAdminPower: boolean;
};

const CATEGORY_OPTIONS = [
  { value: 'all', label: 'All Permissions' },
  { value: 'pages', label: 'Page Access' },
  { value: 'admin', label: 'Admin Powers' },
];

export default function AdminPermissionsPage() {
  const canViewPermissions = useHasPermission(PERMISSIONS.admin.grantPermissions);
  const [schema, setSchema] = useState<PermissionSchema | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState('all');

  useEffect(() => {
    apiJson<PermissionSchema>('/api/admin/permissions/schema')
      .then(setSchema)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const allPermissions = useMemo<PermissionEntry[]>(() => {
    if (!schema) return [];
    const entries: PermissionEntry[] = [];
    for (const group of schema.groups) {
      for (const perm of group.permissions) {
        entries.push({
          key: perm,
          label: schema.labels[perm] || perm,
          group: group.label,
          isAdminPower: perm.startsWith('admin.'),
        });
      }
    }
    return entries;
  }, [schema]);

  const filteredPermissions = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    return allPermissions.filter((perm) => {
      const matchesCategory = activeCategory === 'all' || perm.key.startsWith(activeCategory + '.');
      const matchesSearch =
        !query ||
        perm.label.toLowerCase().includes(query) ||
        perm.key.toLowerCase().includes(query);
      return matchesCategory && matchesSearch;
    });
  }, [allPermissions, searchQuery, activeCategory]);

  const groupedFiltered = useMemo(() => {
    const groups = new Map<string, PermissionEntry[]>();
    for (const perm of filteredPermissions) {
      const existing = groups.get(perm.group) || [];
      existing.push(perm);
      groups.set(perm.group, existing);
    }
    return groups;
  }, [filteredPermissions]);

  if (!canViewPermissions) {
    return (
      <div className="admin-empty-state">
        <Shield size={28} className="text-red-400" style={{ marginBottom: 8 }} />
        <p className="admin-empty-state-title">Access denied</p>
        <p className="admin-empty-state-desc">You do not have permission to view the permission catalog.</p>
      </div>
    );
  }

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

  return (
    <div className="admin-permissions-shell">
      <div className="admin-permissions-header">
        <div className="admin-page-eyebrow">Access Control</div>
        <h1 className="admin-permissions-title">Permission Catalog</h1>
        <p className="admin-permissions-subtitle">
          Reference for all available permissions and their admin power classification.
        </p>
        <div className="admin-underline" />
      </div>

      <div className="admin-permissions-toolbar">
        <div className="admin-permissions-search-wrapper">
          <Search className="admin-permissions-search-icon" />
          <input
            type="search"
            className="admin-permissions-search"
            placeholder="Search permissions by name or key…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label="Search permissions"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              className="admin-permissions-search-clear"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <div className="admin-permissions-filters" role="group" aria-label="Filter by category">
          {CATEGORY_OPTIONS.map((option) => {
            const count =
              option.value === 'all'
                ? allPermissions.length
                : allPermissions.filter((p) => p.key.startsWith(option.value + '.')).length;
            const isActive = activeCategory === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setActiveCategory(option.value)}
                className={`admin-permissions-filter-chip ${isActive ? 'admin-permissions-filter-chip-active' : ''}`}
                aria-pressed={isActive}
              >
                {option.label}
                <span className="admin-permissions-count-badge">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {filteredPermissions.length === 0 ? (
        <div className="admin-permissions-empty">
          <Shield size={28} className="admin-permissions-empty-icon" />
          <p className="admin-permissions-empty-title">No permissions match</p>
          <p className="admin-permissions-empty-desc">
            Try adjusting your search query or clearing the category filter.
          </p>
        </div>
      ) : (
        <div className="admin-permissions-groups">
          {Array.from(groupedFiltered.entries()).map(([groupName, perms]) => (
            <section key={groupName} className="admin-permissions-group">
              <div className="admin-permissions-group-header">
                <h2 className="admin-permissions-group-title">
                  {groupName === 'Admin Powers' ? (
                    <Lock size={16} className="admin-permissions-group-icon" />
                  ) : (
                    <Shield size={16} className="admin-permissions-group-icon" />
                  )}
                  {groupName}
                </h2>
                <span className="admin-permissions-group-count">{perms.length} permission{perms.length === 1 ? '' : 's'}</span>
              </div>
              <div className="admin-permissions-list">
                {perms.map((perm) => (
                  <div key={perm.key} className="admin-permission-item" tabIndex={0} role="listitem">
                    <div className={`admin-permission-icon-box ${perm.isAdminPower ? 'admin-permission-icon-box-admin' : ''}`}>
                      {perm.isAdminPower ? <Lock size={14} /> : <Shield size={14} />}
                    </div>
                    <div className="admin-permission-content">
                      <span className="admin-permission-name">{perm.label}</span>
                      <span className="admin-permission-key">{perm.key}</span>
                    </div>
                    <span className={`admin-permission-badge ${perm.isAdminPower ? 'admin-permission-badge-admin' : 'admin-permission-badge-page'}`}>
                      {perm.isAdminPower ? 'Admin Power' : 'Page Access'}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
