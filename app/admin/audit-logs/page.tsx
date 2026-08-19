'use client';

import { useEffect, useState, useMemo } from 'react';
import { apiJson } from '@/lib/api-client';
import { Shield, User, Clock, Terminal, Search, Filter, Download, ChevronDown, ChevronUp, Eye } from 'lucide-react';

type Log = {
  id: string;
  action: string;
  targetId: string | null;
  createdAt: string;
  actor: { email: string };
  metadata?: Record<string, unknown>;
};

type Category = 'auth' | 'user' | 'admin' | 'payment' | 'system' | 'security';

const CATEGORY_META: Record<string, { label: string; className: string }> = {
  auth: { label: 'Auth', className: 'badge-auth' },
  user: { label: 'User', className: 'badge-user' },
  admin: { label: 'Admin', className: 'badge-admin' },
  payment: { label: 'Payment', className: 'badge-payment' },
  system: { label: 'System', className: 'badge-system' },
  security: { label: 'Security', className: 'badge-security' },
};

function getCategory(action: string): Category {
  const prefix = action.split('.')[0];
  return (CATEGORY_META[prefix] ? prefix : 'system') as Category;
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString();
}

function initials(email: string | null): string {
  if (!email || email === 'system' || email === 'unknown') return email ? email[0].toUpperCase() : '?';
  const parts = email.split('@')[0].split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable');

  const [search, setSearch] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    if (actionFilter) p.set('action', actionFilter);
    if (categoryFilter) p.set('category', categoryFilter);
    if (search) p.set('search', search);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    return p.toString();
  }, [page, pageSize, actionFilter, categoryFilter, search, dateFrom, dateTo]);

  useEffect(() => {
    setLoading(true);
    apiJson<Log[]>(`/api/admin/audit-logs?${queryParams}`)
      .then((data) => {
        setLogs(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [queryParams]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const uniqueActions = useMemo(() => {
    const actions = new Set<string>();
    logs.forEach((l) => actions.add(l.action));
    return Array.from(actions).sort();
  }, [logs]);

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function exportCsv() {
    const header = 'Action,Actor,Target ID,Timestamp,Category,Metadata\n';
    const rows = logs.map((l) => {
      const cat = getCategory(l.action);
      const meta = l.metadata ? JSON.stringify(l.metadata).replace(/"/g, '""') : '';
      return `"${l.action}","${l.actor?.email ?? ''}","${l.targetId ?? ''}","${l.createdAt}","${cat}","${meta}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function clearFilters() {
    setSearch('');
    setActionFilter('');
    setCategoryFilter('');
    setDateFrom('');
    setDateTo('');
    setPage(1);
  }

  const hasActiveFilters = search || actionFilter || categoryFilter || dateFrom || dateTo;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Security &amp; Audit Logs</div>
        <h1 className="admin-page-title">Security &amp; Audit Logs</h1>
        <p className="admin-page-subtitle">Immutable audit trail of administrator mutations, plan changes, and security operations.</p>
        <div className="admin-underline" />
      </div>

      {/* Main Container Card */}
      <div className="card p-4 sm:p-5">
        <div className="admin-card-header">
          <div>
            <h2 className="admin-card-title">Audit Trail ({total})</h2>
            <p className="admin-card-subtitle">
              {total === 0 ? 'No records' : `Showing ${start}-${end}`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowFilters((s) => !s)}
              className={`admin-back-btn ${showFilters ? 'border-[var(--floodlight)] text-[var(--floodlight)]' : ''}`}
              style={{ padding: '6px 12px', fontSize: 12 }}
            >
              <Filter size={13} />
              <span>Filters</span>
            </button>
            <button
              onClick={exportCsv}
              className="admin-back-btn"
              style={{ padding: '6px 12px', fontSize: 12 }}
              disabled={logs.length === 0}
            >
              <Download size={13} />
              <span>Export CSV</span>
            </button>
          </div>
        </div>

        {/* Filters */}
        {showFilters && (
          <div className="p-3.5 rounded-xl bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] space-y-3 mt-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              <div className="admin-form-group" style={{ marginBottom: 0 }}>
                <label className="admin-form-label">Search</label>
                <div style={{ position: 'relative' }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--chalk-muted)' }} />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(1); }}
                    placeholder="Actor, action, target…"
                    className="admin-input"
                    style={{ paddingLeft: 32, fontSize: 13 }}
                  />
                </div>
              </div>
              <div className="admin-form-group" style={{ marginBottom: 0 }}>
                <label className="admin-form-label">Category</label>
                <select
                  value={categoryFilter}
                  onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
                  className="admin-select"
                  style={{ fontSize: 13 }}
                >
                  <option value="">All categories</option>
                  <option value="auth">Auth</option>
                  <option value="user">User</option>
                  <option value="admin">Admin</option>
                  <option value="payment">Payment</option>
                  <option value="system">System</option>
                  <option value="security">Security</option>
                </select>
              </div>
              <div className="admin-form-group" style={{ marginBottom: 0 }}>
                <label className="admin-form-label">Action</label>
                <select
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value); setPage(1); }}
                  className="admin-select"
                  style={{ fontSize: 13 }}
                >
                  <option value="">All actions</option>
                  {uniqueActions.map((a) => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              </div>
              <div className="admin-form-group" style={{ marginBottom: 0 }}>
                <label className="admin-form-label">From</label>
                <input
                  type="date"
                  value={dateFrom}
                  onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
                  className="admin-input"
                  style={{ fontSize: 13 }}
                />
              </div>
              <div className="admin-form-group" style={{ marginBottom: 0 }}>
                <label className="admin-form-label">To</label>
                <input
                  type="date"
                  value={dateTo}
                  onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
                  className="admin-input"
                  style={{ fontSize: 13 }}
                />
              </div>
            </div>
            {hasActiveFilters && (
              <div className="flex items-center justify-between">
                <span className="text-xs text-[var(--chalk-muted)]">
                  {logs.length} result{logs.length !== 1 ? 's' : ''} found
                </span>
                <button
                  onClick={clearFilters}
                  className="text-xs text-[var(--floodlight)] bg-transparent border-none cursor-pointer font-semibold"
                >
                  Clear filters
                </button>
              </div>
            )}
          </div>
        )}

        {/* Loading */}
        {loading ? (
          <div className="admin-loading">Loading audit records…</div>
        ) : logs.length === 0 ? (
          /* Empty state */
          <div className="admin-empty-state">
            <Shield size={28} className="admin-empty-state-icon" />
            <p className="admin-empty-state-title">
              {hasActiveFilters ? 'No matching audit logs' : 'No audit logs recorded'}
            </p>
            <p className="admin-empty-state-desc">
              {hasActiveFilters
                ? 'Try adjusting your search or filters.'
                : 'Admin operations and access alterations will be logged here.'}
            </p>
            {hasActiveFilters && (
              <button onClick={clearFilters} className="btn btn-primary" style={{ marginTop: 16 }}>
                Clear filters
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Desktop Table */}
            <div className="hidden md:block admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th style={{ width: 40 }}></th>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target ID</th>
                    <th>Timestamp</th>
                    <th style={{ width: 80 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => {
                    const cat = getCategory(l.action);
                    const meta = CATEGORY_META[cat] || CATEGORY_META.system;
                    const isExpanded = expanded[l.id];
                    return (
                      <>
                        <tr key={l.id} style={{ cursor: 'pointer' }} onClick={() => toggleExpand(l.id)}>
                          <td onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              style={{ accentColor: 'var(--floodlight)' }}
                              onClick={(e) => e.stopPropagation()}
                            />
                          </td>
                          <td>
                            <span className={`badge ${meta.className}`}>{l.action}</span>
                          </td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              <span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(l.actor?.email)}</span>
                              <span className="text-white font-medium" style={{ fontSize: 13 }}>{l.actor?.email}</span>
                            </div>
                          </td>
                          <td className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>
                            {l.targetId ?? '—'}
                          </td>
                          <td>
                            <div style={{ fontSize: 12, color: 'var(--chalk-muted)' }} title={formatDate(l.createdAt)}>
                              {relativeTime(l.createdAt)}
                            </div>
                          </td>
                          <td>
                            <button
                              className="admin-back-btn"
                              style={{ padding: '4px 8px', fontSize: 11 }}
                              onClick={(e) => { e.stopPropagation(); toggleExpand(l.id); }}
                            >
                              {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                          </td>
                        </tr>
                        {isExpanded && (
                          <tr key={`${l.id}-meta`}>
                            <td colSpan={6} style={{ padding: 0, borderBottom: '1px solid rgba(243,245,236,0.08)' }}>
                              <div className="meta" style={{ padding: '14px 24px' }}>
                                <strong>Log ID:</strong> {l.id} &nbsp;|&nbsp;
                                <strong>Created:</strong> {formatDate(l.createdAt)} &nbsp;|&nbsp;
                                <strong>Category:</strong> {meta.label} &nbsp;|&nbsp;
                                <strong>Metadata:</strong>{' '}
                                <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>
                                  {JSON.stringify(l.metadata || {})}
                                </code>
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards */}
            <div className="md:hidden space-y-3">
              {logs.map((l) => {
                const cat = getCategory(l.action);
                const meta = CATEGORY_META[cat] || CATEGORY_META.system;
                const isExpanded = expanded[l.id];
                return (
                  <div
                    key={l.id}
                    className="p-3.5 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)]"
                    style={{ fontSize: 13 }}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`badge ${meta.className}`}>{l.action}</span>
                      <button
                        onClick={() => toggleExpand(l.id)}
                        className="admin-back-btn"
                        style={{ padding: '4px 8px', fontSize: 11 }}
                      >
                        {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                      </button>
                    </div>
                    <div className="text-xs text-white flex items-center gap-1.5 pt-2">
                      <User size={13} className="text-[var(--chalk-muted)] shrink-0" />
                      <span className="truncate">{l.actor?.email}</span>
                    </div>
                    {l.targetId && (
                      <div className="text-[11px] text-[var(--chalk-muted)] font-mono flex items-center gap-1.5 pt-1.5">
                        <Terminal size={11} className="shrink-0" />
                        <span className="truncate">Target: {l.targetId}</span>
                      </div>
                    )}
                    <div className="text-[11px] text-[var(--chalk-muted)] font-mono flex items-center gap-1.5 pt-1.5">
                      <Clock size={11} className="shrink-0" />
                      <span title={formatDate(l.createdAt)}>{relativeTime(l.createdAt)}</span>
                    </div>
                    {isExpanded && (
                      <div className="meta" style={{ marginTop: 10, padding: '10px 12px' }}>
                        <strong>Log ID:</strong> {l.id} &nbsp;|&nbsp;
                        <strong>Category:</strong> {meta.label} &nbsp;|&nbsp;
                        <strong>Metadata:</strong>{' '}
                        <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4 }}>
                          {JSON.stringify(l.metadata || {})}
                        </code>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* Pagination */}
        {!loading && logs.length > 0 && (
          <div className="pagination">
            <div className="page-info">
              Showing {start}-{end} of {total}
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                className="admin-select"
                style={{ marginLeft: 12, padding: '4px 8px', fontSize: 12 }}
              >
                <option value="10">10 / page</option>
                <option value="20">20 / page</option>
                <option value="50">50 / page</option>
              </select>
            </div>
            <div className="page-buttons">
              <button className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                Previous
              </button>
              <span style={{ fontSize: 12, color: 'var(--chalk-muted)', alignSelf: 'center' }}>
                Page {page} of {totalPages}
              </span>
              <button className="page-btn" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
