'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import {
  Users,
  Download,
  Crown,
  Gift,
  Calendar,
  ChevronRight,
  MoreVertical,
  Mail,
  Phone,
  Globe,
  User,
  Search,
  UserPlus,
  X,
  ShieldAlert,
} from 'lucide-react';
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

type UserRow = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string;
  createdAt: string;
  role: string;
  status: 'Active' | 'Expired' | 'Free' | 'Trial';
  planName: string;
  emailVerifiedAt: string | null;
  permissions: string[];
  grantedBy: string | null;
  grantedAt: string | null;
};

type Stats = {
  totalUsers: number;
  activeSubscribers: number;
  freeTrialUsers: number;
  totalRevenue: number;
  conversionRate: number;
};

type UserApiResponse = {
  users: UserRow[];
  stats: Stats;
  total: number;
};

export default function AdminUsersPage() {
  const canCreateAdmins = useHasPermission(PERMISSIONS.admin.createAdmins);
  const canGrantPermissions = useHasPermission(PERMISSIONS.admin.grantPermissions);

  const [users, setUsers] = useState<UserRow[]>([]);
  const [stats, setStats] = useState<Stats>({
    totalUsers: 0,
    activeSubscribers: 0,
    freeTrialUsers: 0,
    totalRevenue: 0,
    conversionRate: 0,
  });

  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  const [activeTab, setActiveTab] = useState<'all' | 'paid' | 'free'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    name: '',
    email: '',
    phone: '',
    country: 'Nigeria',
  });
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [showPermModal, setShowPermModal] = useState(false);
  const [permUserId, setPermUserId] = useState<string | null>(null);
  const [permRole, setPermRole] = useState('admin');
  const [permList, setPermList] = useState<string[]>([]);
  const [permSaving, setPermSaving] = useState(false);
  const [permError, setPermError] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (activeTab === 'paid') params.set('status', 'paid');
    if (activeTab === 'free') params.set('status', 'free');

    apiJson<UserApiResponse>(`/api/admin/users?${params.toString()}`)
      .then((res) => {
        setUsers(res.users || []);
        if (res.stats) setStats(res.stats);
      })
      .catch((err) => {
        console.error('Failed to fetch users:', err);
      })
      .finally(() => setLoading(false));
  }

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => {
    loadData();
  }, [activeTab, searchQuery]);

  async function exportCsv() {
    setExporting(true);
    try {
      const data = await apiJson<{ csv: string }>('/api/admin/users/export', { method: 'POST' });
      const blob = new Blob([data.csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `predictpro-users-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setExporting(false);
    }
  }

  async function handleCreateUser(e: React.FormEvent) {
    e.preventDefault();
    setModalSaving(true);
    setModalError(null);
    try {
      await apiJson('/api/admin/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(modalForm),
      });
      setShowAddModal(false);
      setModalForm({
        name: '',
        email: '',
        phone: '',
        country: 'Nigeria',
      });
      loadData();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setModalSaving(false);
    }
  }

  function openPermModal(user: UserRow) {
    setPermUserId(user.id);
    setPermRole(user.role);
    setPermList(user.permissions || []);
    setPermError(null);
    setShowPermModal(true);
  }

  async function savePermissions() {
    if (!permUserId) return;
    setPermSaving(true);
    setPermError(null);
    try {
      await apiJson(`/api/admin/users/${permUserId}/permissions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: permRole, permissions: permList }),
      });
      setShowPermModal(false);
      loadData();
    } catch (err) {
      setPermError((err as Error).message);
    } finally {
      setPermSaving(false);
    }
  }

  const now = new Date();
  const thisMonthCount = users.filter((u) => {
    const created = new Date(u.createdAt);
    return created.getMonth() === now.getMonth() && created.getFullYear() === now.getFullYear();
  }).length;

  return (
    <div className="admin-users-wrap">
      <header className="admin-users-header">
        <div className="admin-users-header-left">
          <div className="admin-page-header" style={{ marginBottom: 0 }}>
            <div className="admin-page-eyebrow">Users &amp; Subscribers</div>
            <h1 className="admin-page-title" style={{ fontSize: 34 }}>Users &amp; Subscribers</h1>
            <p className="admin-page-subtitle">Manage registered accounts, subscription history, and export subscriber lists.</p>
            <div className="admin-underline" />
          </div>
        </div>

        <div className="admin-users-actions">
          <button
            type="button"
            onClick={exportCsv}
            disabled={exporting}
            className="admin-users-export-btn"
          >
            <Download size={16} />
            <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>

          {canCreateAdmins && (
            <button
              type="button"
              onClick={() => setShowAddModal(true)}
              className="admin-users-add-btn"
            >
              <UserPlus size={16} />
              <span>Add User</span>
            </button>
          )}
        </div>
      </header>

      <div className="admin-users-stats-grid">
        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Users size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.totalUsers}</div>
          </div>
          <div className="admin-users-stat-label">Total Users</div>
        </div>

        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Crown size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.activeSubscribers}</div>
          </div>
          <div className="admin-users-stat-label">Paid Subscribers</div>
        </div>

        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Gift size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.freeTrialUsers}</div>
          </div>
          <div className="admin-users-stat-label">Free / Trial Users</div>
        </div>

        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Calendar size={20} />
            </div>
            <div className="admin-users-stat-value">{thisMonthCount}</div>
          </div>
          <div className="admin-users-stat-label">This Month</div>
        </div>
      </div>

      <section className="admin-users-list-section">
        <div className="admin-users-list-header">
          <div>
            <h2 className="admin-users-list-title">
              Registered Accounts ({users.length})
            </h2>
            <p className="text-xs text-[#85a694] mt-0.5">Directory of members, roles, and plan statuses</p>
          </div>
          <div className="admin-users-db-pill">
            <span>Real-time DB</span>
            <span className="admin-users-db-dot" />
          </div>
        </div>

        <div className="admin-users-segmented-nav-wrapper">
          <nav className="admin-users-segmented-nav" aria-label="Account Filters">
            <button
              type="button"
              onClick={() => setActiveTab('all')}
              className={`admin-users-segment-tab ${activeTab === 'all' ? 'admin-users-segment-tab-active' : ''}`}
            >
              <Users size={15} />
              <span>All Accounts</span>
              <span className="admin-users-tab-count">{stats.totalUsers}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('paid')}
              className={`admin-users-segment-tab ${activeTab === 'paid' ? 'admin-users-segment-tab-active' : ''}`}
            >
              <Crown size={15} />
              <span>Active Paid</span>
              <span className="admin-users-tab-count">{stats.activeSubscribers}</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveTab('free')}
              className={`admin-users-segment-tab ${activeTab === 'free' ? 'admin-users-segment-tab-active' : ''}`}
            >
              <Gift size={15} />
              <span>Free / Trial</span>
              <span className="admin-users-tab-count">{stats.freeTrialUsers}</span>
            </button>
          </nav>
        </div>

        <div className="relative w-full">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#85a694]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter accounts by name, email, or phone..."
            className="admin-input"
            style={{ paddingLeft: 40 }}
          />
        </div>

        {loading ? (
          <div className="admin-loading">Loading user directory…</div>
        ) : users.length === 0 ? (
          <div className="admin-empty-state">
            <Users size={32} className="admin-empty-state-icon" />
            <p className="admin-empty-state-title">No accounts match criteria</p>
            <p className="admin-empty-state-desc">Try adjusting search query or tab filters.</p>
          </div>
        ) : (
          <div className="admin-users-cards-stack">
            {users.map((u) => {
              const formattedDate = new Date(u.createdAt).toLocaleDateString('en-US', {
                month: 'numeric',
                day: 'numeric',
                year: 'numeric',
              });
              const countryCode = u.country === 'Nigeria' ? 'NG' : u.country.slice(0, 2).toUpperCase();

              return (
                <div key={u.id} className="admin-user-item-card">
                  <div className="admin-user-card-left">
                    <div className="admin-user-avatar">
                      <User size={22} />
                    </div>

                    <div className="admin-user-info-stack">
                      <div className="admin-user-title-row">
                        <span className="admin-user-name">{u.name}</span>
                        {u.status === 'Active' ? (
                          <span className="admin-user-badge-paid">Paid Subscriber</span>
                        ) : (
                          <span className="admin-user-badge-free">{u.status} User</span>
                        )}
                        {!u.emailVerifiedAt && (
                          <span
                            title="This account has not verified its email address"
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: 'var(--card-red)',
                              background: 'rgba(220,38,38,0.12)',
                              border: '1px solid rgba(220,38,38,0.3)',
                              borderRadius: 4,
                              padding: '2px 6px',
                              textTransform: 'uppercase',
                            }}
                          >
                            Unverified
                          </span>
                        )}
                      </div>

                      <div className="admin-user-meta-row">
                        <div className="admin-user-meta-item">
                          <Mail size={14} className="text-[#85a694]" />
                          <span>{u.email}</span>
                        </div>

                        {u.phone && (
                          <div className="admin-user-meta-item">
                            <Phone size={14} className="text-[#85a694]" />
                            <span>{u.phone}</span>
                          </div>
                        )}

                        <div className="admin-user-meta-item">
                          <Globe size={14} className="text-[#85a694]" />
                          <span>{countryCode}</span>
                        </div>
                      </div>

                      <div className="admin-user-meta-row" style={{ marginTop: '2px' }}>
                        <div className="admin-user-meta-item">
                          <Calendar size={14} className="text-[#85a694]" />
                          <span>{formattedDate}</span>
                        </div>
                        <span className="text-xs text-[#557564]">Joined / Expires</span>
                      </div>

                      {u.role === 'admin' && u.permissions && u.permissions.length > 0 && (
                        <div className="admin-user-meta-row" style={{ marginTop: '2px' }}>
                          <div className="flex flex-wrap gap-1">
                            {u.permissions.map((p) => (
                              <span key={p} className="admin-status-pill admin-status-pill-warning" style={{ fontSize: 10, padding: '1px 6px' }}>
                                {p.replace('pages.', '').replace('admin.', '')}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="admin-user-card-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="admin-user-details-btn"
                    >
                      <span>View Details</span>
                      <ChevronRight size={16} />
                    </Link>

                     {u.role === 'admin' && canGrantPermissions && (
                       <button
                         onClick={() => openPermModal(u)}
                         className="admin-user-details-btn"
                         style={{ background: 'rgba(245,179,53,0.12)', border: '1px solid rgba(245,179,53,0.35)', color: '#f5b335' }}
                       >
                         <span>Edit Permissions</span>
                         <ShieldAlert size={16} />
                       </button>
                     )}

                    <div className="relative">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                        className="admin-user-more-btn"
                        title="More options"
                      >
                        <MoreVertical size={18} />
                      </button>

                      {openMenuId === u.id && (
                        <div className="absolute right-0 top-10 z-20 w-44 bg-[#153c2a] border border-[rgba(243,245,236,0.16)] rounded-xl shadow-2xl py-1 text-left">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="block px-4 py-2 text-xs text-white hover:bg-[#0b2216] transition-colors"
                          >
                            Manage Account
                          </Link>
                          <button
                            onClick={() => {
                              setOpenMenuId(null);
                              alert(`Exporting audit log for ${u.name}`);
                            }}
                            className="w-full text-left px-4 py-2 text-xs text-[#85a694] hover:text-white hover:bg-[#0b2216] transition-colors"
                          >
                            Export Activity
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#102e20] border border-[rgba(243,245,236,0.16)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[rgba(243,245,236,0.1)] mb-4">
              <h3 className="font-bold text-lg text-white">Add New User Account</h3>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-[#85a694] hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleCreateUser} className="flex flex-col gap-4">
              <div className="admin-form-group">
                <label htmlFor="name" className="admin-form-label">Full Name *</label>
                <input
                  id="name"
                  type="text"
                  required
                  value={modalForm.name}
                  onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                  placeholder="Kelechi Eme"
                  className="admin-input"
                />
              </div>

              <div className="admin-form-group">
                <label htmlFor="email" className="admin-form-label">Email Address *</label>
                <input
                  id="email"
                  type="email"
                  required
                  value={modalForm.email}
                  onChange={(e) => setModalForm({ ...modalForm, email: e.target.value })}
                  placeholder="emekelechi883@gmail.com"
                  className="admin-input"
                />
              </div>

              <div className="admin-form-row-2col">
                <div className="admin-form-group">
                  <label htmlFor="phone" className="admin-form-label">Phone</label>
                  <input
                    id="phone"
                    type="text"
                    value={modalForm.phone}
                    onChange={(e) => setModalForm({ ...modalForm, phone: e.target.value })}
                    placeholder="+2348057531862"
                    className="admin-input"
                  />
                </div>

                <div className="admin-form-group">
                  <label htmlFor="country" className="admin-form-label">Country</label>
                  <input
                    id="country"
                    type="text"
                    value={modalForm.country}
                    onChange={(e) => setModalForm({ ...modalForm, country: e.target.value })}
                    placeholder="Nigeria"
                    className="admin-input"
                  />
                </div>
              </div>

              {modalError && (
                <div className="admin-form-error">
                  <ShieldAlert size={15} className="shrink-0" />
                  <span>{modalError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[rgba(243,245,236,0.1)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-ghost py-2 px-4 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="btn btn-primary py-2 px-5 text-sm font-semibold"
                >
                  {modalSaving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showPermModal && permUserId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm">
          <div className="bg-[#102e20] border border-[rgba(243,245,236,0.16)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl p-6">
            <div className="flex items-center justify-between pb-4 border-b border-[rgba(243,245,236,0.1)] mb-4">
              <h3 className="font-bold text-lg text-white">Edit Admin Permissions</h3>
              <button
                onClick={() => setShowPermModal(false)}
                className="text-[#85a694] hover:text-white p-1 rounded-lg"
              >
                <X size={18} />
              </button>
            </div>

            <div className="flex flex-col gap-4">
              <div className="admin-form-group">
                <label className="admin-form-label">Role</label>
                <select
                  value={permRole}
                  onChange={(e) => setPermRole(e.target.value)}
                  className="admin-select"
                >
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              {permRole === 'admin' && (
                <div className="admin-form-group">
                  <label className="admin-form-label">Page Permissions</label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {Object.entries(PERMISSION_OPTIONS).map(([key, label]) => (
                      <label key={key} className="flex items-center gap-2 text-xs text-white cursor-pointer">
                        <input
                          type="checkbox"
                          checked={permList.includes(key)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setPermList([...permList, key]);
                            } else {
                              setPermList(permList.filter((p) => p !== key));
                            }
                          }}
                          style={{ accentColor: 'var(--floodlight)' }}
                        />
                        {label}
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {permError && (
                <div className="admin-form-error">
                  <ShieldAlert size={15} className="shrink-0" />
                  <span>{permError}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[rgba(243,245,236,0.1)]">
                <button
                  type="button"
                  onClick={() => setShowPermModal(false)}
                  className="btn btn-ghost py-2 px-4 text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={permSaving}
                  onClick={savePermissions}
                  className="btn btn-primary py-2 px-5 text-sm font-semibold"
                >
                  {permSaving ? 'Saving…' : 'Save Permissions'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
