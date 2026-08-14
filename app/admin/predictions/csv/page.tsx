'use client';

import { useState } from 'react';
import { apiFetch } from '@/lib/api-client';

type PreviewRow = { line: number; date: string; time: string; matches: string; prediction: string; bookingCode: string };
type PreviewResult = { rows: PreviewRow[]; errors: { line: number; message: string }[]; bookingCode: string | null };

export default function CsvImportPage() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [title, setTitle] = useState('');
  const [publishNow, setPublishNow] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setPreview(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await apiFetch('/api/admin/predictions/csv/preview', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Preview failed');
      setPreview(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function confirm() {
    if (!preview) return;
    setConfirming(true);
    setError(null);
    try {
      const res = await apiFetch('/api/admin/predictions/csv/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          visibility: 'subscribers',
          bookingCode: preview.bookingCode,
          publishNow,
          rows: preview.rows,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Import failed');
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <>
                <h1 className="display" style={{ fontSize: 28, marginBottom: 8 }}>Import predictions from CSV</h1>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 24 }}>
            Required columns: <span className="mono">date, time, matches, prediction, booking_code</span>
          </p>

          {done ? (
            <div className="card">
              <p style={{ color: 'var(--floodlight)', marginBottom: 16 }}>Import complete.</p>
              <a href="/admin/predictions" className="btn btn-primary">Back to predictions</a>
            </div>
          ) : (
            <>
              <div className="card" style={{ marginBottom: 24 }}>
                <input type="file" accept=".csv" onChange={onFileChange} disabled={uploading} />
                {uploading && <p style={{ marginTop: 12, fontSize: 13, color: 'var(--chalk-muted)' }}>Validating…</p>}
              </div>

              {error && <div className="error-text" style={{ marginBottom: 16 }}>{error}</div>}

              {preview && (
                <div className="card">
                  <h2 style={{ fontSize: 16, marginBottom: 12 }}>
                    {preview.errors.length === 0 ? `${preview.rows.length} rows, ready to import` : `${preview.errors.length} error(s) found`}
                  </h2>

                  {preview.errors.length > 0 ? (
                    <div className="table-container">
                      <table style={{ width: '100%', minWidth: 320, borderCollapse: 'collapse', fontSize: 13, marginBottom: 16 }}>
                        <thead>
                          <tr style={{ textAlign: 'left', color: 'var(--card-red)' }}>
                            <th style={{ padding: '4px 8px 4px 0' }}>Line</th>
                            <th>Issue</th>
                          </tr>
                        </thead>
                        <tbody>
                          {preview.errors.map((e, i) => (
                            <tr key={i}>
                              <td style={{ padding: '4px 8px 4px 0' }}>{e.line}</td>
                              <td style={{ color: 'var(--chalk-muted)' }}>{e.message}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <>
                      <div className="table-container">
                        <table style={{ width: '100%', minWidth: 440, borderCollapse: 'collapse', fontSize: 13, marginBottom: 20 }}>
                          <thead>
                            <tr style={{ textAlign: 'left', color: 'var(--chalk-muted)' }}>
                              <th style={{ padding: '4px 8px 4px 0' }}>Date</th>
                              <th>Time</th>
                              <th>Match</th>
                              <th>Prediction</th>
                            </tr>
                          </thead>
                          <tbody>
                            {preview.rows.map((r) => (
                              <tr key={r.line} style={{ borderTop: '1px solid rgba(243,245,236,0.08)' }}>
                                <td style={{ padding: '4px 8px 4px 0' }}>{r.date}</td>
                                <td>{r.time}</td>
                                <td>{r.matches}</td>
                                <td className="mono">{r.prediction}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      <div className="field">
                        <label htmlFor="title">Post title</label>
                        <input id="title" required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Saturday Big Wins" />
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, marginBottom: 20 }}>
                        <input type="checkbox" checked={publishNow} onChange={(e) => setPublishNow(e.target.checked)} />
                        Publish immediately
                      </label>

                      <button onClick={confirm} className="btn btn-primary" disabled={confirming || !title}>
                        {confirming ? 'Importing…' : `Import ${preview.rows.length} matches`}
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
    </>
  );
}
