'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { Shield, User, Clock, CreditCard, Settings, AlertTriangle, Search, X, Download, ChevronDown, ChevronUp, Copy, CheckCircle2, Info, AlertCircle, ShieldAlert } from 'lucide-react';
import { apiJson } from '@/lib/api-client';

type Log = {
  id: string;
  action: string;
  targetId: string | null;
  createdAt: string;
  actor: { email: string };
  metadata?: Record<string, unknown>;
};

type AuditLogResponse = {
  logs: Log[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  availableActions: string[];
};

type Severity = 'success' | 'info' | 'warning' | 'critical';

const CATEGORY_META: Record<string, { label: string; icon: any; rowIconClass: string }> = {
  auth: { label: 'Authentication', icon: Shield, rowIconClass: 'admin-audit-row-icon-auth' },
  payment: { label: 'Payments', icon: CreditCard, rowIconClass: 'admin-audit-row-icon-payment' },
  user: { label: 'Users', icon: User, rowIconClass: 'admin-audit-row-icon-user' },
  admin: { label: 'Admin', icon: ShieldAlert, rowIconClass: 'admin-audit-row-icon-security' },
  security: { label: 'Security', icon: ShieldAlert, rowIconClass: 'admin-audit-row-icon-security' },
  system: { label: 'System', icon: Settings, rowIconClass: 'admin-audit-row-icon-system' },
};

const QUICK_FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'auth', label: 'Authentication' },
  { value: 'payment', label: 'Payments' },
  { value: 'user', label: 'Users' },
  { value: 'security', label: 'Security' },
  { value: 'system', label: 'System' },
];

function getCategory(action: string): string {
  const prefix = action.split('.')[0];
  return CATEGORY_META[prefix] ? prefix : 'system';
}

function getSeverity(action: string, metadata?: Record<string, unknown>): Severity {
  const lower = action.toLowerCase();
  if (lower.includes('failure') || lower.includes('failed') || lower.includes('denied')) return 'warning';
  if (lower.includes('success') || lower.includes('completed') || lower.includes('enabled')) return 'success';
  if (lower.includes('security') || lower.includes('alert') || lower.includes('critical')) return 'critical';
  if (metadata?.severity === 'critical') return 'critical';
  if (metadata?.severity === 'warning') return 'warning';
  return 'info';
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

function formatDateFull(iso: string): string {
  return new Date(iso).toLocaleString();
}

function getDateGroup(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);

  if (date >= today) return 'Today';
  if (date >= yesterday) return 'Yesterday';
  if (date >= weekAgo) return 'Earlier This Week';
  return 'Earlier';
}

function initials(email: string | null): string {
  if (!email || email === 'system' || email === 'unknown') return email ? email[0].toUpperCase() : '?';
  const parts = email.split('@')[0].split(/[._-]/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return email.slice(0, 2).toUpperCase();
}

function truncateId(id: string | null, chars = 8): string {
  if (!id) return '—';
  if (id.length <= chars * 2) return id;
  return `${id.slice(0, chars)}…${id.slice(-chars)}`;
}

function formatMetadata(metadata?: Record<string, unknown>): string {
  if (!metadata || Object.keys(metadata).length === 0) return '{}';
  const formatted = JSON.stringify(metadata, null, 2);
  if (formatted.length > 500) {
    return formatted.slice(0, 500) + '\n…';
  }
  return formatted;
}

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [availableActions, setAvailableActions] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [search, setSearch] = useState('');
  const [quickFilter, setQuickFilter] = useState('all');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [severityFilter, setSeverityFilter] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  const [exportOpen, setExportOpen] = useState(false);

  const queryParams = useMemo(() => {
    const p = new URLSearchParams();
    p.set('page', String(page));
    p.set('pageSize', String(pageSize));
    if (search) p.set('search', search);
    if (quickFilter !== 'all') p.set('category', quickFilter);
    if (categoryFilter) p.set('category', categoryFilter);
    if (dateFrom) p.set('dateFrom', dateFrom);
    if (dateTo) p.set('dateTo', dateTo);
    if (actionFilter) p.set('action', actionFilter);
    return p.toString();
  }, [page, pageSize, search, quickFilter, categoryFilter, dateFrom, dateTo, actionFilter]);

  useEffect(() => {
    setLoading(true);
    apiJson<AuditLogResponse>(`/api/admin/audit-logs?${queryParams}`)
      .then((data) => {
        setLogs(data.logs);
        setTotal(data.total);
        setTotalPages(data.totalPages);
        setAvailableActions(data.availableActions);
      })
      .finally(() => setLoading(false));
  }, [queryParams]);

  const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  const metrics = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayLogs = logs.filter((l) => new Date(l.createdAt) >= today).length;
    const securityAlerts = logs.filter((l) => {
      const sev = getSeverity(l.action, l.metadata);
      return sev === 'critical' || sev === 'warning';
    }).length;
    return { total, today: todayLogs, securityAlerts };
  }, [logs, total]);

  const groupedLogs = useMemo(() => {
    const groups = new Map<string, Log[]>();
    for (const log of logs) {
      const group = getDateGroup(log.createdAt);
      const existing = groups.get(group) || [];
      existing.push(log);
      groups.set(group, existing);
    }
    return groups;
  }, [logs]);

  const hasActiveFilters = search || quickFilter !== 'all' || categoryFilter || dateFrom || dateTo || severityFilter || actionFilter;

  const activeFilterChips = useMemo(() => {
    const chips: { label: string; onRemove: () => void }[] = [];
    if (quickFilter !== 'all') {
      chips.push({ label: QUICK_FILTERS.find(f => f.value === quickFilter)?.label || quickFilter, onRemove: () => { setQuickFilter('all'); setPage(1); } });
    }
    if (categoryFilter) {
      chips.push({ label: `Category: ${categoryFilter}`, onRemove: () => { setCategoryFilter(''); setPage(1); } });
    }
    if (severityFilter) {
      chips.push({ label: `Severity: ${severityFilter}`, onRemove: () => { setSeverityFilter(''); setPage(1); } });
    }
    if (dateFrom) {
      chips.push({ label: `From: ${dateFrom}`, onRemove: () => { setDateFrom(''); setPage(1); } });
    }
    if (dateTo) {
      chips.push({ label: `To: ${dateTo}`, onRemove: () => { setDateTo(''); setPage(1); } });
    }
    if (actionFilter) {
      chips.push({ label: `Action: ${actionFilter}`, onRemove: () => { setActionFilter(''); setPage(1); } });
    }
    return chips;
  }, [quickFilter, categoryFilter, severityFilter, dateFrom, dateTo, actionFilter]);

  function toggleExpand(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function clearFilters() {
    setSearch('');
    setQuickFilter('all');
    setCategoryFilter('');
    setSeverityFilter('');
    setDateFrom('');
    setDateTo('');
    setActionFilter('');
    setPage(1);
    setExportOpen(false);
  }

  async function copyToClipboard(text: string) {
    await navigator.clipboard.writeText(text);
  }

  function exportCsv(scope: 'page' | 'filtered' | 'all') {
    const header = 'Action,Actor,Target ID,Timestamp,Category,Severity,Metadata\n';
    const rows = logs.map((l) => {
      const cat = getCategory(l.action);
      const sev = getSeverity(l.action, l.metadata);
      const meta = l.metadata ? JSON.stringify(l.metadata).replace(/"/g, '""') : '';
      return `"${l.action}","${l.actor?.email ?? ''}","${l.targetId ?? ''}","${l.createdAt}","${cat}","${sev}","${meta}"`;
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    setExportOpen(false);
  }

  function SeverityBadge({ severity }: { severity: Severity }) {
    const config = {
      success: { label: 'Success', className: 'admin-audit-severity-success', Icon: CheckCircle2 },
      info: { label: 'Info', className: 'admin-audit-severity-info', Icon: Info },
      warning: { label: 'Warning', className: 'admin-audit-severity-warning', Icon: AlertCircle },
      critical: { label: 'Critical', className: 'admin-audit-severity-critical', Icon: AlertTriangle },
    };
    const { label, className, Icon } = config[severity];
    return (
      <span className={`admin-audit-severity ${className}`} title={label}>
        <Icon size={10} />
        {label}
      </span>
    );
  }

  return (
    <div className="admin-audit-shell">
      {/* Header */}
      <div className="admin-audit-header">
        <div className="admin-page-eyebrow">Access Control</div>
        <h1 className="admin-audit-title">Security &amp; Audit Logs</h1>
        <p className="admin-audit-subtitle">
          Immutable audit trail of administrator mutations, plan changes, and security operations.
        </p>
        <div className="admin-underline" />
      </div>

      {/* Summary Metrics */}
      <div className="admin-audit-metrics">
        <div className="admin-audit-metric-card">
          <div className="admin-audit-metric-label">Total Events</div>
          <div className="admin-audit-metric-value">{metrics.total.toLocaleString()}</div>
          <div className="admin-audit-metric-trend">All time</div>
        </div>
        <div className="admin-audit-metric-card">
          <div className="admin-audit-metric-label">Today</div>
          <div className="admin-audit-metric-value">{metrics.today}</div>
          <div className="admin-audit-metric-trend">{new Date().toLocaleDateString()}</div>
        </div>
        <div className="admin-audit-metric-card">
          <div className="admin-audit-metric-label">Security Alerts</div>
          <div className="admin-audit-metric-value" style={{ color: metrics.securityAlerts > 0 ? '#f87171' : '#4ade80' }}>
            {metrics.securityAlerts}
          </div>
          <div className="admin-audit-metric-trend">
            {metrics.securityAlerts > 0 ? 'Requires attention' : 'No critical alerts'}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="admin-audit-toolbar">
        <div className="admin-audit-search-wrapper">
          <Search className="admin-audit-search-icon" />
          <input
            type="search"
            className="admin-audit-search"
            placeholder="Search events, users, targets or log IDs..."
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            aria-label="Search audit logs"
          />
          {search && (
            <button
              type="button"
              onClick={() => { setSearch(''); setPage(1); }}
              className="admin-audit-search-clear"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="admin-audit-quick-filters" role="group" aria-label="Quick filters">
          {QUICK_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => { setQuickFilter(filter.value); setPage(1); }}
              className={`admin-audit-filter-chip ${quickFilter === filter.value ? 'admin-audit-filter-chip-active' : ''}`}
              aria-pressed={quickFilter === filter.value}
            >
              {filter.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setAdvancedOpen((s) => !s)}
          className="admin-audit-advanced-toggle"
          aria-expanded={advancedOpen}
        >
          <Settings size={14} />
          Filters
        </button>

        <div className="admin-audit-export-dropdown">
          <button
            type="button"
            onClick={() => setExportOpen((s) => !s)}
            className="admin-audit-advanced-toggle"
            aria-expanded={exportOpen}
          >
            <Download size={14} />
            Export
          </button>
          {exportOpen && (
            <div className="admin-audit-export-menu" role="menu">
              <button type="button" className="admin-audit-export-option" onClick={() => exportCsv('page')} role="menuitem">
                Current page
              </button>
              <button type="button" className="admin-audit-export-option" onClick={() => exportCsv('filtered')} role="menuitem">
                Filtered results
              </button>
              <button type="button" className="admin-audit-export-option" onClick={() => exportCsv('all')} role="menuitem">
                All matching records
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Active Filters */}
      {activeFilterChips.length > 0 && (
        <div className="admin-audit-active-filters">
          {activeFilterChips.map((chip, idx) => (
            <span
              key={idx}
              className="admin-audit-filter-chip admin-audit-filter-chip-active"
              style={{ cursor: 'default' }}
            >
              {chip.label}
              <button
                type="button"
                onClick={chip.onRemove}
                className="admin-audit-filter-chip-remove"
                aria-label={`Remove filter: ${chip.label}`}
              >
                <X size={10} />
              </button>
            </span>
          ))}
          <button
            type="button"
            onClick={clearFilters}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#f5b335',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              padding: '4px 8px',
            }}
          >
            Clear all
          </button>
        </div>
      )}

      {/* Advanced Filters Panel */}
      {advancedOpen && (
        <div className="admin-audit-advanced-panel">
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-form-label">Category</label>
            <select
              value={categoryFilter}
              onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
              className="admin-select"
            >
              <option value="">All categories</option>
              {Object.entries(CATEGORY_META).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
          </div>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-form-label">Severity</label>
            <select
              value={severityFilter}
              onChange={(e) => { setSeverityFilter(e.target.value); setPage(1); }}
              className="admin-select"
            >
              <option value="">All severities</option>
              <option value="success">Success</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
          </div>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-form-label">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
              className="admin-input"
            />
          </div>
          <div className="admin-form-group" style={{ marginBottom: 0 }}>
            <label className="admin-form-label">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
              className="admin-input"
            />
          </div>
        </div>
      )}

      {/* Content */}
      {loading ? (
        <div className="admin-audit-loading-skeleton">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="admin-audit-skeleton-row" />
          ))}
        </div>
      ) : logs.length === 0 ? (
        <div className="admin-audit-empty">
          <Shield size={28} className="admin-audit-empty-icon" />
          <p className="admin-audit-empty-title">
            {hasActiveFilters ? 'No matching audit events' : 'No audit events recorded'}
          </p>
          <p className="admin-audit-empty-desc">
            {hasActiveFilters
              ? 'Try adjusting your search query or clearing the active filters.'
              : 'Admin operations and access alterations will be logged here automatically.'}
          </p>
          {hasActiveFilters && (
            <button onClick={clearFilters} className="btn btn-primary" style={{ marginTop: 16 }}>
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className="admin-audit-list" role="list">
          {Array.from(groupedLogs.entries()).map(([groupName, groupLogs]) => (
            <div key={groupName} className="admin-audit-date-group" role="listitem">
              <div className="admin-audit-date-header">{groupName}</div>
              {groupLogs.map((log) => {
                const category = getCategory(log.action);
                const categoryInfo = CATEGORY_META[category] || CATEGORY_META.system;
                const CategoryIcon = categoryInfo.icon;
                const severity = getSeverity(log.action, log.metadata);
                const isExpanded = expanded[log.id];

                return (
                  <div key={log.id} className="admin-audit-row-wrapper">
                    <div
                      className="admin-audit-row"
                      onClick={() => toggleExpand(log.id)}
                      role="button"
                      tabIndex={0}
                      aria-expanded={isExpanded}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleExpand(log.id);
                        }
                      }}
                    >
                      <div className={`admin-audit-row-icon ${categoryInfo.rowIconClass}`}>
                        <CategoryIcon size={16} />
                      </div>
                      <div className="admin-audit-row-content">
                        <div className="admin-audit-row-title">{log.action}</div>
                        <div className="admin-audit-row-meta">
                          <span className="admin-audit-row-meta-item">
                            <User size={12} />
                            {log.actor?.email}
                          </span>
                          {log.targetId && (
                            <span className="admin-audit-row-meta-item" style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: '#557564' }}>
                              {truncateId(log.targetId)}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="admin-audit-row-actions">
                        <SeverityBadge severity={severity} />
                        <button
                          className="admin-audit-expand-btn"
                          onClick={(e) => { e.stopPropagation(); toggleExpand(log.id); }}
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
                        >
                          {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </button>
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="admin-audit-details" role="region" aria-label={`Details for ${log.action}`}>
                        <div className="admin-audit-details-grid">
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Event</div>
                            <div className="admin-audit-detail-value">{log.action}</div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Status</div>
                            <div className="admin-audit-detail-value">
                              <SeverityBadge severity={severity} />
                            </div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Actor</div>
                            <div className="admin-audit-detail-value">{log.actor?.email}</div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Category</div>
                            <div className="admin-audit-detail-value">{categoryInfo.label}</div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Target</div>
                            <div className="admin-audit-detail-value-mono">{log.targetId ?? '—'}</div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Time</div>
                            <div className="admin-audit-detail-value">{formatDateFull(log.createdAt)}</div>
                          </div>
                          <div className="admin-audit-detail-item">
                            <div className="admin-audit-detail-label">Log ID</div>
                            <div className="admin-audit-detail-value-mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {truncateId(log.id, 12)}
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); copyToClipboard(log.id); }}
                                className="admin-audit-detail-copy"
                                aria-label="Copy log ID"
                              >
                                <Copy size={10} />
                                Copy
                              </button>
                            </div>
                          </div>
                          {log.targetId && (
                            <div className="admin-audit-detail-item">
                              <div className="admin-audit-detail-label">Target ID</div>
                              <div className="admin-audit-detail-value-mono" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                {truncateId(log.targetId, 12)}
                                {log.targetId && (
                                  <button
                                    type="button"
                                    onClick={(e) => { e.stopPropagation(); copyToClipboard(log.targetId as string); }}
                                    className="admin-audit-detail-copy"
                                    aria-label="Copy target ID"
                                  >
                                    <Copy size={10} />
                                    Copy
                                  </button>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                        {log.metadata && Object.keys(log.metadata).length > 0 && (
                          <div className="admin-audit-detail-item" style={{ marginTop: 4 }}>
                            <div className="admin-audit-detail-label">Metadata</div>
                            <pre
                              className="admin-audit-detail-value-mono"
                              style={{
                                background: 'rgba(0,0,0,0.3)',
                                padding: '10px 12px',
                                borderRadius: 8,
                                overflow: 'auto',
                                maxHeight: 200,
                                fontSize: 11,
                                lineHeight: 1.5,
                              }}
                            >
                              {formatMetadata(log.metadata)}
                            </pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && logs.length > 0 && (
        <div className="admin-audit-pagination">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="admin-audit-page-info">
              Showing {start}–{end} of {total.toLocaleString()}
            </span>
            <select
              value={pageSize}
              onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="admin-audit-page-size-select"
              aria-label="Rows per page"
            >
              <option value="10">10 / page</option>
              <option value="20">20 / page</option>
              <option value="50">50 / page</option>
            </select>
          </div>
          <div className="admin-audit-page-controls">
            <button
              className="admin-audit-page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
              aria-label="Previous page"
            >
              ‹ Previous
            </button>
            {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
              let pageNum: number;
              if (totalPages <= 5) {
                pageNum = i + 1;
              } else if (page <= 3) {
                pageNum = i + 1;
              } else if (page >= totalPages - 2) {
                pageNum = totalPages - 4 + i;
              } else {
                pageNum = page - 2 + i;
              }
              return (
                <button
                  key={pageNum}
                  className={`admin-audit-page-btn ${page === pageNum ? 'admin-audit-page-btn-active' : ''}`}
                  onClick={() => setPage(pageNum)}
                  aria-label={`Page ${pageNum}`}
                  aria-current={page === pageNum ? 'page' : undefined}
                >
                  {pageNum}
                </button>
              );
            })}
            {totalPages > 5 && page < totalPages - 2 && (
              <span style={{ color: '#85a694', fontSize: 12 }}>…</span>
            )}
            {totalPages > 5 && page < totalPages - 2 && (
              <button
                className="admin-audit-page-btn"
                onClick={() => setPage(totalPages)}
                aria-label={`Page ${totalPages}`}
              >
                {totalPages}
              </button>
            )}
            <button
              className="admin-audit-page-btn"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
              aria-label="Next page"
            >
              Next ›
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
