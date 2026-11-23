'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

export default function AdminAnalysisPage() {
  const [runs, setRuns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<{ runs?: any[] }>('/api/superadmin/analysis/runs')
      .then((d) => setRuns(d.runs ?? []))
      .catch(() => setRuns([]))
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="admin-audit-shell">
      <div className="admin-audit-header">
        <div className="admin-page-eyebrow">Analysis</div>
        <h1 className="admin-audit-title">Analysis Runs</h1>
        <p className="admin-audit-subtitle">Superadmin analysis runs and results.</p>
        <div className="admin-underline" />
      </div>
      {loading ? (
        <div>Loading…</div>
      ) : runs.length === 0 ? (
        <div className="admin-audit-empty">
          <p className="admin-audit-empty-title">No analysis runs</p>
        </div>
      ) : (
        <pre>{JSON.stringify(runs, null, 2)}</pre>
      )}
    </div>
  );
}
