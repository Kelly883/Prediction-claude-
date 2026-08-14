'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Log = { id: string; action: string; targetId: string | null; createdAt: string; actor: { email: string } };

export default function AdminAuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<Log[]>('/api/admin/audit-logs').then(setLogs).finally(() => setLoading(false));
  }, []);

  return (
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 20 }}>Audit log</h1>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-container">
            <table style={{ width: '100%', minWidth: 480, borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                  <th style={{ padding: '8px 0' }}>Action</th>
                  <th>Actor</th>
                  <th>Target</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((l) => (
                  <tr key={l.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                    <td className="mono" style={{ padding: '8px 0' }}>{l.action}</td>
                    <td>{l.actor?.email}</td>
                    <td className="mono" style={{ fontSize: 12, color: 'var(--chalk-muted)' }}>{l.targetId ?? '—'}</td>
                    <td>{new Date(l.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
