'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import {
  Users,
  Crown,
  Gift,
  Calendar,
  Download,
  Mail,
  Phone,
  Globe,
  MoreVertical,
  ChevronRight,
  User as UserIcon
} from 'lucide-react';

type EnrichedUser = {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  country: string;
  role: string;
  createdAt: string;
  isPaid: boolean;
  expiresAt: string | null;
};

export default function AdminUsersPage() {
  const [allUsers, setAllUsers] = useState<EnrichedUser[]>([]);
  const [filter, setFilter] = useState<'all' | 'paid' | 'unpaid'>('all');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    // Fetch all users to compute live KPI stats properly
    apiJson<EnrichedUser[]>('/api/admin/users')
      .then(setAllUsers)
      .finally(() => setLoading(false));
  }, []);

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
    } finally {
      setExporting(false);
    }
  }

  // Calculate stats
  const stats = useMemo(() => {
    const total = allUsers.length;
    const paid = allUsers.filter((u) => u.isPaid).length;
    const free = total - paid;

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const thisMonth = allUsers.filter((u) => new Date(u.createdAt) >= startOfMonth).length;

    return { total, paid, free, thisMonth };
  }, [allUsers]);

  // Filtered users
  const displayedUsers = useMemo(() => {
    if (filter === 'paid') return allUsers.filter((u) => u.isPaid);
    if (filter === 'unpaid') return allUsers.filter((u) => !u.isPaid);
    return allUsers;
  }, [allUsers, filter]);

  function formatDate(dateStr: string) {
    const d = new Date(dateStr);
    return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  }

  return (
    <div className="admin-users-wrap">
      {/* Page Header Title & Subtitle */}
      <header className="admin-users-header">
        <h1 className="admin-users-title">Users &amp; Subscribers</h1>
        <p className="admin-users-subtitle">
          Manage registered accounts, subscription history, and export subscriber lists.
        </p>
      </header>

      {/* Export CSV Button */}
      <div>
        <button onClick={exportCsv} disabled={exporting} className="admin-users-export-btn">
          <Download size={18} />
          <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
        </button>
      </div>

      {/* Account Type Filter Tabs */}
      <div className="admin-users-filter-row">
        <button
          onClick={() => setFilter('all')}
          className={`admin-users-filter-btn ${filter === 'all' ? 'admin-users-filter-btn-active' : ''}`}
        >
          <Users size={18} />
          <span>All Accounts</span>
        </button>

        <button
          onClick={() => setFilter('paid')}
          className={`admin-users-filter-btn ${filter === 'paid' ? 'admin-users-filter-btn-active' : ''}`}
        >
          <Crown size={18} />
          <span>Active Paid Subscribers</span>
        </button>

        <button
          onClick={() => setFilter('unpaid')}
          className={`admin-users-filter-btn ${filter === 'unpaid' ? 'admin-users-filter-btn-active' : ''}`}
        >
          <Gift size={18} />
          <span>Free / Trial Users</span>
        </button>
      </div>

      {/* KPI Stats Grid */}
      <div className="admin-users-kpi-bar">
        <div className="admin-users-kpi-item">
          <div className="admin-users-kpi-icon-val">
            <Users size={20} className="text-[#f5b335]" />
            <span className="admin-users-kpi-val">{stats.total}</span>
          </div>
          <span className="admin-users-kpi-label">Total Users</span>
        </div>

        <div className="admin-users-kpi-divider" />

        <div className="admin-users-kpi-item">
          <div className="admin-users-kpi-icon-val">
            <Crown size={20} className="text-[#4ade80]" />
            <span className="admin-users-kpi-val">{stats.paid}</span>
          </div>
          <span className="admin-users-kpi-label">Paid Subscribers</span>
        </div>

        <div className="admin-users-kpi-divider" />

        <div className="admin-users-kpi-item">
          <div className="admin-users-kpi-icon-val">
            <Gift size={20} className="text-[#4ade80]" />
            <span className="admin-users-kpi-val">{stats.free}</span>
          </div>
          <span className="admin-users-kpi-label">Free / Trial Users</span>
        </div>

        <div className="admin-users-kpi-divider" />

        <div className="admin-users-kpi-item">
          <div className="admin-users-kpi-icon-val">
            <Calendar size={20} className="text-[#4ade80]" />
            <span className="admin-users-kpi-val">{stats.thisMonth}</span>
          </div>
          <span className="admin-users-kpi-label">This Month</span>
        </div>
      </div>

      {/* Registered Accounts Section */}
      <div className="admin-users-section-card">
        <div className="admin-users-section-top">
          <h2 className="admin-users-section-heading">
            Registered Accounts ({displayedUsers.length})
          </h2>

          <div className="admin-users-realtime-badge">
            <span>Real-time DB</span>
            <span className="admin-users-realtime-dot" />
          </div>
        </div>

        {loading ? (
          <div className="p-8 text-center text-[#85a694] text-sm">
            Loading accounts…
          </div>
        ) : displayedUsers.length === 0 ? (
          <div className="p-8 text-center text-[#85a694] text-sm">
            No accounts found matching the selected filter.
          </div>
        ) : (
          <div className="admin-users-list">
            {displayedUsers.map((user) => (
              <div key={user.id} className="admin-user-card">
                {/* Avatar Icon */}
                <div className="admin-user-avatar">
                  <UserIcon size={24} className="text-[#f5b335]" />
                </div>

                {/* User Content Info */}
                <div className="admin-user-info-col">
                  {/* Top Row: Name + Status Pill + Menu Icon */}
                  <div className="admin-user-top-row">
                    <div className="admin-user-name-group">
                      <span className="admin-user-name">{user.name}</span>
                      <span className={`admin-user-status-pill ${user.isPaid ? 'admin-user-status-paid' : 'admin-user-status-free'}`}>
                        {user.isPaid ? 'Paid Subscriber' : 'Free / Trial'}
                      </span>
                    </div>

                    <button className="admin-user-menu-btn" title="Options">
                      <MoreVertical size={18} />
                    </button>
                  </div>

                  {/* Email */}
                  <div className="admin-user-meta-line">
                    <Mail size={15} className="text-[#85a694]" />
                    <span>{user.email}</span>
                  </div>

                  {/* Phone & Country */}
                  <div className="admin-user-meta-line">
                    <Phone size={15} className="text-[#85a694]" />
                    <span>{user.phone || 'No phone'}</span>
                    <Globe size={15} className="text-[#85a694] ml-1" />
                    <span className="admin-user-country-code">{user.country || 'NG'}</span>
                  </div>

                  {/* Joined / Expires Date Row + Action Button */}
                  <div className="admin-user-bottom-row">
                    <div className="admin-user-meta-line">
                      <Calendar size={15} className="text-[#85a694]" />
                      <div className="flex flex-col">
                        <span className="font-mono">{formatDate(user.createdAt)}</span>
                        <span className="text-[11px] text-[#6e9480]">Joined / Expires</span>
                      </div>
                    </div>

                    <Link href={`/admin/users/${user.id}`} className="admin-user-details-btn">
                      <span>View Details</span>
                      <ChevronRight size={16} />
                    </Link>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
