'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson } from '@/lib/api-client';
import { Users, Download, ShieldCheck, Mail, Calendar, Globe, Phone } from 'lucide-react';

type UserRow = { id: string; name: string; email: string; phone: string | null; country: string; createdAt: string; role?: string };

export default function AdminUsersPage() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [filter, setFilter] = useState<'' | 'paid' | 'unpaid'>('');
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiJson<UserRow[]>(`/api/admin/users${filter ? `?status=${filter}` : ''}`).then(setUsers).finally(() => setLoading(false));
  }, [filter]);

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <div>
          <h1 className="font-bold text-2xl sm:text-3xl text-white">Users & Subscribers</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-1">
            Manage registered accounts, subscription history, and export subscriber lists.
          </p>
        </div>
        <button
          onClick={exportCsv}
          className="btn btn-ghost text-xs sm:text-sm py-2 px-4 inline-flex items-center gap-1.5 self-start sm:self-auto"
          disabled={exporting}
        >
          <Download size={14} />
          <span>{exporting ? 'Exporting…' : 'Export CSV'}</span>
        </button>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {(['', 'paid', 'unpaid'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`text-xs sm:text-sm py-1.5 px-3.5 rounded-md font-medium transition-all ${
              filter === f
                ? 'bg-[var(--floodlight)] text-[var(--pitch)] font-semibold'
                : 'bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)]'
            }`}
          >
            {f === '' ? 'All Accounts' : f === 'paid' ? 'Active Paid Subscribers' : 'Free / Trial Users'}
          </button>
        ))}
      </div>

      {/* Users List Container */}
      <div className="card p-4 sm:p-5">
        <h2 className="text-base font-semibold text-white mb-4 flex items-center justify-between">
          <span>Registered Accounts ({users.length})</span>
          <span className="text-xs text-[var(--chalk-muted)] font-mono">Real-time DB</span>
        </h2>

        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
            Loading user directory…
          </div>
        ) : users.length === 0 ? (
          <div className="p-8 text-center border border-dashed border-[rgba(243,245,236,0.14)] rounded-lg">
            <Users size={28} className="mx-auto mb-2 text-[var(--floodlight)] opacity-80" />
            <p className="text-sm text-white font-medium">No users found</p>
            <p className="text-xs text-[var(--chalk-muted)] mt-1">
              Registered member profiles and subscribers will show here.
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {users.map((u) => (
              <div
                key={u.id}
                className="p-4 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/admin/users/${u.id}`}
                      className="font-semibold text-base text-white hover:text-[var(--floodlight)] transition-colors"
                    >
                      {u.name}
                    </Link>
                    {u.role === 'admin' && (
                      <span className="px-2 py-0.5 text-[9px] font-bold uppercase rounded bg-amber-500/20 text-amber-300 border border-amber-500/30">
                        Admin
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-[var(--chalk-muted)] flex-wrap">
                    <span className="flex items-center gap-1">
                      <Mail size={12} />
                      {u.email}
                    </span>
                    {u.phone && (
                      <span className="flex items-center gap-1 font-mono">
                        <Phone size={12} />
                        {u.phone}
                      </span>
                    )}
                    <span className="flex items-center gap-1 font-mono">
                      <Globe size={12} />
                      {u.country}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-3 self-end sm:self-center">
                  <span className="text-xs text-[var(--chalk-muted)] font-mono flex items-center gap-1">
                    <Calendar size={12} />
                    {new Date(u.createdAt).toLocaleDateString()}
                  </span>
                  <Link
                    href={`/admin/users/${u.id}`}
                    className="btn btn-ghost text-xs py-1.5 px-3"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

