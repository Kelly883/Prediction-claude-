'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiJson, apiFetch } from '@/lib/api-client';

type UserRow = { id: string; name: string; email: string; phone: string | null; country: string; createdAt: string };

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
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24 }}>
        <h1 className="display" style={{ fontSize: 28 }}>Users</h1>
        <button onClick={exportCsv} className="btn btn-ghost" style={{ padding: '8px 16px', fontSize: 13 }} disabled={exporting}>
          {exporting ? 'Exporting…' : 'Export CSV'}
        </button>
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {(['', 'paid', 'unpaid'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={filter === f ? 'btn btn-primary' : 'btn btn-ghost'}
            style={{ padding: '6px 14px', fontSize: 13 }}
          >
            {f === '' ? 'All' : f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>

      <div className="card">
        {loading ? (
          <p>Loading…</p>
        ) : (
          <div className="table-container">
            <table style={{ width: '100%', minWidth: 460, borderCollapse: 'collapse', fontSize: 14 }}>
              <thead>
                <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)', fontSize: 12 }}>
                  <th style={{ padding: '8px 0' }}>Name</th>
                  <th>Email</th>
                  <th>Country</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                    <td style={{ padding: '8px 0' }}>
                      <Link href={`/admin/users/${u.id}`} style={{ color: 'var(--chalk)' }}>{u.name}</Link>
                    </td>
                    <td>{u.email}</td>
                    <td>{u.country}</td>
                    <td>{new Date(u.createdAt).toLocaleDateString()}</td>
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
