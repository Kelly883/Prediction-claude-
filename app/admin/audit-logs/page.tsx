'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { Shield, User, Clock, Terminal } from 'lucide-react';

type Log = {
  id: string;
  action: string;
  targetId: string | null;
  createdAt: string;
  actor: { email: string };
};

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<Log[]>('/api/admin/audit-logs')
      .then(setLogs)
      .finally(() => setLoading(false));
  }, []);

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
          <h2 className="admin-card-title">Audit Trail ({logs.length})</h2>
          <span className="admin-card-subtitle">System Trail</span>
        </div>

        {loading ? (
          <div className="admin-loading">Loading audit records…</div>
        ) : logs.length === 0 ? (
          <div className="admin-empty-state">
            <Shield size={28} className="admin-empty-state-icon" />
            <p className="admin-empty-state-title">No audit logs recorded</p>
            <p className="admin-empty-state-desc">Admin operations and access alterations will be logged here.</p>
          </div>
        ) : (
          <>
            {/* Desktop / Tablet Table */}
            <div className="hidden md:block admin-table-wrapper">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Action</th>
                    <th>Actor</th>
                    <th>Target ID</th>
                    <th>Timestamp</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <span className="mono font-semibold text-[var(--floodlight)] bg-[rgba(245,179,53,0.1)] px-2 py-0.5 rounded text-xs">
                          {l.action}
                        </span>
                      </td>
                      <td className="text-white font-medium">{l.actor?.email}</td>
                      <td className="mono text-xs text-[var(--chalk-muted)]">
                        {l.targetId ?? '—'}
                      </td>
                      <td className="text-xs text-[var(--chalk-muted)] font-mono">
                        {new Date(l.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile Cards View */}
            <div className="md:hidden space-y-3">
              {logs.map((l) => (
                <div
                  key={l.id}
                  className="p-3.5 rounded-lg bg-[var(--pitch)] border border-[rgba(243,245,236,0.1)] space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="mono font-semibold text-[var(--floodlight)] bg-[rgba(245,179,53,0.1)] px-2 py-0.5 rounded text-xs">
                      {l.action}
                    </span>
                    <span className="text-[11px] text-[var(--chalk-muted)] font-mono flex items-center gap-1">
                      <Clock size={11} />
                      {new Date(l.createdAt).toLocaleDateString()}
                    </span>
                  </div>

                  <div className="text-xs text-white flex items-center gap-1.5 pt-1">
                    <User size={13} className="text-[var(--chalk-muted)] shrink-0" />
                    <span className="truncate">{l.actor?.email}</span>
                  </div>

                  {l.targetId && (
                    <div className="text-[11px] text-[var(--chalk-muted)] font-mono flex items-center gap-1.5 pt-1 border-t border-[rgba(243,245,236,0.06)]">
                      <Terminal size={11} className="shrink-0" />
                      <span className="truncate">Target: {l.targetId}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
