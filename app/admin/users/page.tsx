'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import {
  Users,
  UserPlus,
  Download,
  Search,
  ChevronLeft,
  ChevronRight,
  X,
  Check,
  MoreVertical,
  TrendingUp,
  CreditCard,
  UserCheck,
  Clock,
  Shield,
  Mail,
  Phone,
  Globe,
  Lock,
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

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [roleFilter, setRoleFilter] = useState('all');

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 8;

  // Actions menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  // Modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [modalForm, setModalForm] = useState({
    name: '',
    email: '',
    phone: '',
    country: 'Nigeria',
    role: 'user',
    status: 'Active',
    planName: 'Pro',
    sendWelcomeEmail: true,
  });
  const [modalSaving, setModalSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  function loadData() {
    setLoading(true);
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    if (statusFilter !== 'all') params.set('status', statusFilter);
    if (roleFilter !== 'all') params.set('role', roleFilter);

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
    setCurrentPage(1);
  }, [searchQuery, statusFilter, roleFilter]);

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
        sendWelcomeEmail: true,
      });
      loadData();
    } catch (err) {
      setModalError((err as Error).message);
    } finally {
      setModalSaving(false);
    }
  }

  // Calculate pagination
  const totalEntries = users.length;
  const totalPages = Math.ceil(totalEntries / pageSize) || 1;
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalEntries);
  const currentUsers = users.slice(startIndex, endIndex);

  // Get user initials for avatar
  function getInitials(name: string) {
    if (!name) return 'U';
    const parts = name.trim().split(' ');
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
    return name.slice(0, 2).toUpperCase();
  }

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white tracking-tight">Users</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Manage users, subscriptions, and roles.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddModal(true)}
            className="btn btn-primary text-xs sm:text-sm py-2 px-4 inline-flex items-center gap-2 font-semibold shadow-md"
          >
            <UserPlus size={16} />
            <span>Add User</span>
          </button>

          <button
            onClick={exportCsv}
            disabled={exporting}
            className="btn btn-ghost text-xs sm:text-sm py-2 px-4 inline-flex items-center gap-2 bg-[#133826] hover:bg-[#18452f] text-white border border-[rgba(243,245,236,0.12)] rounded-lg transition-colors"
          >
            <Download size={16} />
            <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
          </button>
        </div>
      </div>

      {/* Top Overview Cards (4 Metric Cards) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Total Users */}
        <div className="card p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[var(--chalk-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Users</span>
            <div className="p-2 rounded-lg bg-[var(--turf)] text-[var(--floodlight)]">
              <Users size={18} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {stats.totalUsers.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-400 font-medium">
            <TrendingUp size={14} />
            <span>Active registered accounts</span>
          </div>
        </div>

        {/* Card 2: Active Subscribers */}
        <div className="card p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[var(--chalk-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Active Subscribers</span>
            <div className="p-2 rounded-lg bg-[var(--turf)] text-emerald-400">
              <UserCheck size={18} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {stats.activeSubscribers.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-400 font-medium">
            <span>{stats.conversionRate}% conversion rate</span>
          </div>
        </div>

        {/* Card 3: Free / Trial Users */}
        <div className="card p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[var(--chalk-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Free / Trial Users</span>
            <div className="p-2 rounded-lg bg-[var(--turf)] text-amber-400">
              <Clock size={18} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            {stats.freeTrialUsers.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-[var(--chalk-muted)] font-medium">
            <span>Potential conversions</span>
          </div>
        </div>

        {/* Card 4: Total Revenue */}
        <div className="card p-4 bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] rounded-xl relative overflow-hidden">
          <div className="flex items-center justify-between text-[var(--chalk-muted)] mb-2">
            <span className="text-xs font-medium uppercase tracking-wider">Total Volume</span>
            <div className="p-2 rounded-lg bg-[var(--turf)] text-[var(--floodlight)]">
              <CreditCard size={18} />
            </div>
          </div>
          <div className="text-2xl sm:text-3xl font-bold text-white tracking-tight">
            ₦{stats.totalRevenue.toLocaleString()}
          </div>
          <div className="flex items-center gap-1.5 mt-2 text-xs text-emerald-400 font-medium">
            <span>Successful payment checkouts</span>
          </div>
        </div>
      </div>

      {/* Filters & Search Row */}
      <div className="card p-4 bg-[var(--turf)] border border-[rgba(243,245,236,0.1)] rounded-xl flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        {/* Search Bar */}
        <div className="relative flex-1">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--chalk-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, email..."
            className="w-full bg-[var(--pitch)] text-white text-sm pl-10 pr-4 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)] transition-colors placeholder:text-[var(--chalk-muted)]"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--chalk-muted)] font-medium">Status:</label>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-[var(--pitch)] text-white text-xs sm:text-sm py-2 px-3 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)] transition-colors cursor-pointer"
            >
              <option value="all">All Statuses</option>
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="free">Free</option>
              <option value="trial">Trial</option>
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs text-[var(--chalk-muted)] font-medium">Role:</label>
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
              className="bg-[var(--pitch)] text-white text-xs sm:text-sm py-2 px-3 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)] transition-colors cursor-pointer"
            >
              <option value="all">All Roles</option>
              <option value="admin">Admin</option>
              <option value="user">User</option>
            </select>
          </div>
        </div>
      </div>

      {/* Users Data Table Container */}
      <div className="card bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] rounded-xl overflow-hidden shadow-lg">
        {loading ? (
          <div className="p-12 text-center text-sm text-[var(--chalk-muted)]">
            Loading user directory…
          </div>
        ) : currentUsers.length === 0 ? (
          <div className="p-12 text-center border-t border-[rgba(243,245,236,0.06)]">
            <Users size={32} className="mx-auto mb-3 text-[var(--floodlight)] opacity-80" />
            <p className="text-base text-white font-medium">No users found</p>
            <p className="text-xs text-[var(--chalk-muted)] mt-1">
              Try adjusting your search query or filter selections.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-[#0f2d1e] text-[var(--chalk-muted)] text-xs uppercase tracking-wider font-semibold border-b border-[rgba(243,245,236,0.1)]">
                  <th className="py-3.5 px-4 sm:px-6">User</th>
                  <th className="py-3.5 px-4">Status</th>
                  <th className="py-3.5 px-4">Role</th>
                  <th className="py-3.5 px-4">Subscription Plan</th>
                  <th className="py-3.5 px-4">Joined Date</th>
                  <th className="py-3.5 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[rgba(243,245,236,0.06)] text-sm">
                {currentUsers.map((u) => {
                  const initials = getInitials(u.name);
                  return (
                    <tr
                      key={u.id}
                      className="hover:bg-[#133826]/50 transition-colors group"
                    >
                      {/* User Avatar + Name + Email */}
                      <td className="py-4 px-4 sm:px-6">
                        <div className="flex items-center gap-3">
                          <div className="w-9 h-9 rounded-full bg-[var(--turf)] border border-[var(--floodlight)]/30 text-[var(--floodlight)] font-bold text-xs flex items-center justify-center shrink-0 shadow-inner">
                            {initials}
                          </div>
                          <div className="min-w-0">
                            <Link
                              href={`/admin/users/${u.id}`}
                              className="font-semibold text-white hover:text-[var(--floodlight)] transition-colors block truncate"
                            >
                              {u.name}
                            </Link>
                            <span className="text-xs text-[var(--chalk-muted)] block truncate">
                              {u.email}
                            </span>
                          </div>
                        </div>
                      </td>

                      {/* Status Badge */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {u.status === 'Active' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                            Active
                          </span>
                        ) : u.status === 'Expired' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            Expired
                          </span>
                        ) : u.status === 'Trial' ? (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-500/15 text-blue-300 border border-blue-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                            Trial
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-zinc-500/15 text-zinc-300 border border-zinc-500/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" />
                            Free
                          </span>
                        )}
                      </td>

                      {/* Role Badge */}
                      <td className="py-4 px-4 whitespace-nowrap">
                        {u.role === 'admin' ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded text-xs font-bold uppercase bg-amber-500/20 text-amber-300 border border-amber-500/30">
                            <Shield size={12} />
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center px-2.5 py-0.5 rounded text-xs font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
                            User
                          </span>
                        )}
                      </td>

                      {/* Subscription Plan */}
                      <td className="py-4 px-4 text-white font-medium whitespace-nowrap">
                        {u.planName}
                      </td>

                      {/* Joined Date */}
                      <td className="py-4 px-4 text-[var(--chalk-muted)] text-xs font-mono whitespace-nowrap">
                        {new Date(u.createdAt).toLocaleDateString(undefined, {
                          year: 'numeric',
                          month: 'short',
                          day: 'numeric',
                        })}
                      </td>

                      {/* Actions */}
                      <td className="py-4 px-4 text-right whitespace-nowrap relative">
                        <div className="inline-flex items-center gap-2">
                          <Link
                            href={`/admin/users/${u.id}`}
                            className="btn btn-ghost text-xs py-1 px-2.5 text-[var(--floodlight)] hover:bg-[var(--turf)] rounded transition-colors"
                          >
                            View Details
                          </Link>
                          <button
                            onClick={() => setOpenMenuId(openMenuId === u.id ? null : u.id)}
                            className="p-1 text-[var(--chalk-muted)] hover:text-white rounded transition-colors"
                            title="More options"
                          >
                            <MoreVertical size={16} />
                          </button>
                        </div>

                        {/* Dropdown Menu */}
                        {openMenuId === u.id && (
                          <div className="absolute right-4 top-12 z-20 w-44 bg-[var(--turf)] border border-[rgba(243,245,236,0.14)] rounded-lg shadow-xl py-1 text-left">
                            <Link
                              href={`/admin/users/${u.id}`}
                              className="block px-4 py-2 text-xs text-white hover:bg-[#133826] transition-colors"
                            >
                              Manage User
                            </Link>
                            <button
                              onClick={() => {
                                setOpenMenuId(null);
                                alert(`Exporting audit log for ${u.name}`);
                              }}
                              className="w-full text-left px-4 py-2 text-xs text-[var(--chalk-muted)] hover:text-white hover:bg-[#133826] transition-colors"
                            >
                              Export Activity
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Bottom Pagination Bar */}
        {!loading && totalEntries > 0 && (
          <div className="p-4 border-t border-[rgba(243,245,236,0.08)] flex flex-col sm:flex-row items-center justify-between gap-4 bg-[#0a2316]">
            <div className="text-xs text-[var(--chalk-muted)]">
              Showing <span className="font-semibold text-white">{startIndex + 1}</span> to{' '}
              <span className="font-semibold text-white">{endIndex}</span> of{' '}
              <span className="font-semibold text-white">{totalEntries}</span> entries
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setCurrentPage((p) => Math.max(p - 1, 1))}
                disabled={currentPage === 1}
                className="p-1.5 rounded-lg border border-[rgba(243,245,236,0.12)] text-[var(--chalk-muted)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--turf)] transition-colors"
              >
                <ChevronLeft size={16} />
              </button>

              {Array.from({ length: totalPages }).map((_, idx) => {
                const pageNum = idx + 1;
                return (
                  <button
                    key={pageNum}
                    onClick={() => setCurrentPage(pageNum)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium transition-colors ${
                      currentPage === pageNum
                        ? 'bg-[var(--floodlight)] text-[var(--pitch)] font-bold'
                        : 'text-[var(--chalk-muted)] hover:text-white hover:bg-[var(--turf)] border border-[rgba(243,245,236,0.1)]'
                    }`}
                  >
                    {pageNum}
                  </button>
                );
              })}

              <button
                onClick={() => setCurrentPage((p) => Math.min(p + 1, totalPages))}
                disabled={currentPage === totalPages}
                className="p-1.5 rounded-lg border border-[rgba(243,245,236,0.12)] text-[var(--chalk-muted)] hover:text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--turf)] transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Add User Modal */}
      {showAddModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fadeIn">
          <div className="bg-[var(--turf)] border border-[rgba(243,245,236,0.16)] rounded-2xl w-full max-w-lg overflow-hidden shadow-2xl">
            {/* Modal Header */}
            <div className="p-5 border-b border-[rgba(243,245,236,0.1)] flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-[var(--floodlight)]/15 text-[var(--floodlight)]">
                  <UserPlus size={18} />
                </div>
                <div>
                  <h3 className="font-bold text-lg text-white">Add New User</h3>
                  <p className="text-xs text-[var(--chalk-muted)]">Create a new member account manually.</p>
                </div>
              </div>
              <button
                onClick={() => setShowAddModal(false)}
                className="text-[var(--chalk-muted)] hover:text-white p-1 rounded-lg transition-colors"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Form Body */}
            <form onSubmit={handleCreateUser} className="p-5 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Full Name */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={modalForm.name}
                    onChange={(e) => setModalForm({ ...modalForm, name: e.target.value })}
                    placeholder="John Doe"
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)]"
                  />
                </div>

                {/* Email Address */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Email Address *</label>
                  <input
                    type="email"
                    required
                    value={modalForm.email}
                    onChange={(e) => setModalForm({ ...modalForm, email: e.target.value })}
                    placeholder="john@example.com"
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Phone */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Phone Number</label>
                  <input
                    type="text"
                    value={modalForm.phone}
                    onChange={(e) => setModalForm({ ...modalForm, phone: e.target.value })}
                    placeholder="+234..."
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)]"
                  />
                </div>

                {/* Country */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Country</label>
                  <input
                    type="text"
                    value={modalForm.country}
                    onChange={(e) => setModalForm({ ...modalForm, country: e.target.value })}
                    placeholder="Nigeria"
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Role */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Role</label>
                  <select
                    value={modalForm.role}
                    onChange={(e) => setModalForm({ ...modalForm, role: e.target.value })}
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)] cursor-pointer"
                  >
                    <option value="user">User</option>
                    <option value="admin">Admin</option>
                  </select>
                </div>

                {/* Subscription Plan */}
                <div className="space-y-1">
                  <label className="text-xs text-[var(--chalk-muted)] font-medium">Plan</label>
                  <select
                    value={modalForm.planName}
                    onChange={(e) => setModalForm({ ...modalForm, planName: e.target.value })}
                    className="w-full bg-[var(--pitch)] text-white text-sm px-3.5 py-2.5 rounded-lg border border-[rgba(243,245,236,0.12)] focus:outline-none focus:border-[var(--floodlight)] cursor-pointer"
                  >
                    <option value="Free">Free Account</option>
                    <option value="Pro">Pro Membership</option>
                    <option value="VIP Pass">VIP Pass</option>
                  </select>
                </div>
              </div>

              {/* Send Welcome Email Checkbox */}
              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="welcomeEmail"
                  checked={modalForm.sendWelcomeEmail}
                  onChange={(e) => setModalForm({ ...modalForm, sendWelcomeEmail: e.target.checked })}
                  className="rounded border-[rgba(243,245,236,0.2)] bg-[var(--pitch)] text-[var(--floodlight)] focus:ring-0 cursor-pointer"
                />
                <label htmlFor="welcomeEmail" className="text-xs text-white cursor-pointer select-none">
                  Send welcome email with account setup instructions
                </label>
              </div>

              {modalError && (
                <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-xs">
                  {modalError}
                </div>
              )}

              {/* Modal Action Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[rgba(243,245,236,0.1)]">
                <button
                  type="button"
                  onClick={() => setShowAddModal(false)}
                  className="btn btn-ghost text-xs py-2 px-4 text-[var(--chalk-muted)] hover:text-white"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={modalSaving}
                  className="btn btn-primary text-xs py-2 px-5 font-semibold"
                >
                  {modalSaving ? 'Saving…' : 'Create User'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
