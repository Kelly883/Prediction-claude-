'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
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
} from 'lucide-react';

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

  // Active filter tab: 'all' | 'paid' | 'free'
  const [activeTab, setActiveTab] = useState<'all' | 'paid' | 'free'>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Dropdown menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Add user modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    name: '',
    email: '',
    phone: '',
    country: 'Nigeria',
    role: 'user',
    status: 'Active',
    planName: 'Pro',
  });
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

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
        role: 'user',
        status: 'Active',
        planName: 'Pro',
      });
      loadData();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setModalSaving(false);
    }
  }

  // Calculate "This Month" count dynamically based on createdAt
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const thisMonthCount = users.filter((u) => {
    const created = new Date(u.createdAt);
    return created.getMonth() === currentMonth && created.getFullYear() === currentYear;
  }).length;

  return (
    <div className="admin-users-wrap">
      {/* Header Bar */}
      <header className="admin-users-header">
        <div>
          <h1 className="admin-users-title">Users &amp; Subscribers</h1>
          <p className="admin-users-subtitle">
            Manage registered accounts, subscription history, and export subscriber lists.
          </p>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="admin-users-export-btn"
          >
            <Download size={16} />
            <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>

          <button
            onClick={() => setShowAddModal(true)}
            className="admin-users-export-btn"
            style={{ background: '#f5b335', color: '#0a2116', borderColor: '#f5b335' }}
          >
            <UserPlus size={16} />
            <span>Add User</span>
          </button>
        </div>
      </header>

      {/* Segmented Filter Pills */}
      <nav className="admin-users-segmented-nav" aria-label="Account Filters">
        <button
          onClick={() => setActiveTab('all')}
          className={`admin-users-segment-tab ${activeTab === 'all' ? 'admin-users-segment-tab-active' : ''}`}
        >
          <Users size={16} />
          <span>All Accounts</span>
        </button>

        <button
          onClick={() => setActiveTab('paid')}
          className={`admin-users-segment-tab ${activeTab === 'paid' ? 'admin-users-segment-tab-active' : ''}`}
        >
          <Crown size={16} />
          <span>Active Paid Subscribers</span>
        </button>

        <button
          onClick={() => setActiveTab('free')}
          className={`admin-users-segment-tab ${activeTab === 'free' ? 'admin-users-segment-tab-active' : ''}`}
        >
          <Gift size={16} />
          <span>Free / Trial Users</span>
        </button>
      </nav>

      {/* Stats Summary Grid (4 Cards matching reference mockup) */}
      <div className="admin-users-stats-grid">
        {/* Card 1: Total Users */}
        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Users size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.totalUsers}</div>
          </div>
          <div className="admin-users-stat-label">Total Users</div>
        </div>

        {/* Card 2: Paid Subscribers */}
        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Crown size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.activeSubscribers}</div>
          </div>
          <div className="admin-users-stat-label">Paid Subscribers</div>
        </div>

        {/* Card 3: Free / Trial Users */}
        <div className="admin-users-stat-card">
          <div className="admin-users-stat-header">
            <div className="admin-users-stat-icon">
              <Gift size={20} />
            </div>
            <div className="admin-users-stat-value">{stats.freeTrialUsers}</div>
          </div>
          <div className="admin-users-stat-label">Free / Trial Users</div>
        </div>

        {/* Card 4: This Month */}
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

      {/* Registered Accounts Section */}
      <section className="admin-users-list-section">
        {/* Section Header */}
        <div className="admin-users-list-header">
          <h2 className="admin-users-list-title">
            Registered Accounts ({users.length})
          </h2>
          <div className="admin-users-db-pill">
            <span>Real-time DB</span>
            <span className="admin-users-db-dot" />
          </div>
        </div>

        {/* Search Input Bar */}
        <div className="relative w-full">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#85a694]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter accounts by name, email, or phone..."
            className="w-full bg-[#0b2216] text-white text-sm pl-10 pr-4 py-2.5 rounded-xl border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[#f5b335] transition-colors placeholder:text-[#557564]"
          />
        </div>

        {/* User Cards Feed Stack */}
        {loading ? (
          <div className="p-8 text-center text-sm text-[#85a694]">
            Loading user directory…
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.12)] rounded-xl">
            <Users size={32} className="mx-auto mb-2 text-[#f5b335] opacity-80" />
            <p className="text-base text-white font-semibold">No accounts match criteria</p>
            <p className="text-xs text-[#85a694] mt-1">Try adjusting search query or tab filters.</p>
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
                  {/* Left Column: Avatar + User details */}
                  <div className="admin-user-card-left">
                    <div className="admin-user-avatar">
                      <User size={22} />
                    </div>

                    <div className="admin-user-info-stack">
                      {/* Name & Status Pill */}
                      <div className="admin-user-title-row">
                        <span className="admin-user-name">{u.name}</span>
                        {u.status === 'Active' ? (
                          <span className="admin-user-badge-paid">Paid Subscriber</span>
                        ) : (
                          <span className="admin-user-badge-free">{u.status} User</span>
                        )}
                      </div>

                      {/* Contact & Location Meta Row */}
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

                      {/* Joined / Expires Date Row */}
                      <div className="admin-user-meta-row" style={{ marginTop: '2px' }}>
                        <div className="admin-user-meta-item">
                          <Calendar size={14} className="text-[#85a694]" />
                          <span>{formattedDate}</span>
                        </div>
                        <span className="text-xs text-[#557564]">Joined / Expires</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Column: Actions */}
                  <div className="admin-user-card-right">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="admin-user-details-btn"
                    >
                      <span>View Details</span>
                      <ChevronRight size={16} />
                    </Link>

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

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
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

            <form onSubmit={handleCreateUser} className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs text-[#85a694] font-medium">Full Name *</label>
                <input
                  type="text"
                  required
                  value={modalForm.name}
                  onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                  placeholder="Kelechi Eme"
                  className="w-full bg-[#0b2216] text-white text-sm px-3.5 py-2.5 rounded-xl border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[#f5b335]"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs text-[#85a694] font-medium">Email Address *</label>
                <input
                  type="email"
                  required
                  value={modalForm.email}
                  onChange={(e) => setModalForm({ ...modalForm, email: e.target.value })}
                  placeholder="emekelechi883@gmail.com"
                  className="w-full bg-[#0b2216] text-white text-sm px-3.5 py-2.5 rounded-xl border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[#f5b335]"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <label className="text-xs text-[#85a694] font-medium">Phone</label>
                  <input
                    type="text"
                    value={modalForm.phone}
                    onChange={(e) => setModalForm({ ...modalForm, phone: e.target.value })}
                    placeholder="+2348057531862"
                    className="w-full bg-[#0b2216] text-white text-sm px-3.5 py-2.5 rounded-xl border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[#f5b335]"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-[#85a694] font-medium">Country</label>
                  <input
                    type="text"
                    value={modalForm.country}
                    onChange={(e) => setModalForm({ ...modalForm, country: e.target.value })}
                    placeholder="Nigeria"
                    className="w-full bg-[#0b2216] text-white text-sm px-3.5 py-2.5 rounded-xl border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[#f5b335]"
                  />
                </div>
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {modalError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[rgba(243,245,236,0.1)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 text-xs font-semibold text-[#85a694] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="px-5 py-2 text-xs font-bold bg-[#f5b335] text-[#0a2116] rounded-xl hover:brightness-105"
                >
                  {modalSaving ? 'Creating…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
