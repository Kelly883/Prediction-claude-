'use client';

import { useState } from 'react';
import Link from 'next/link';
import { apiFetch } from '@/lib/api-client';
import { Upload, ArrowLeft, CheckCircle2, AlertCircle, FileText, Sparkles } from 'lucide-react';

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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 pb-2 border-b border-[rgba(243,245,236,0.1)]">
        <Link
          href="/admin/predictions"
          className="p-2 rounded-lg bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)] transition-colors"
          title="Back to Predictions"
        >
          <ArrowLeft size={16} />
        </Link>
        <div>
          <h1 className="font-bold text-xl sm:text-2xl text-white">Import Predictions from CSV</h1>
          <p className="text-xs sm:text-sm text-[var(--chalk-muted)] mt-0.5">
            Required columns: <code className="mono text-white">date, time, matches, prediction, booking_code</code>
          </p>
        </div>
      </div>

      {done ? (
        <div className="card p-6 text-center space-y-3">
          <CheckCircle2 size={32} className="mx-auto text-emerald-400" />
          <h2 className="text-lg font-bold text-white">CSV Import Completed Successfully</h2>
          <p className="text-xs text-[var(--chalk-muted)]">
            Your match slip picks and booking code are now imported.
          </p>
          <div className="pt-2">
            <Link href="/admin/predictions" className="btn btn-primary text-sm py-2 px-4 inline-flex items-center gap-1.5">
              <span>View Predictions Archive</span>
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-6">
          {/* File Upload Drop Area */}
          <div className="card p-5 sm:p-6 text-center space-y-3">
            <Upload size={32} className="mx-auto text-[var(--floodlight)] opacity-80" />
            <h2 className="text-base font-semibold text-white">Upload CSV Slip File</h2>
            <p className="text-xs text-[var(--chalk-muted)] max-w-md mx-auto">
              Select a .csv file exported from Excel, Google Sheets, or your betting analysis sheet.
            </p>
            <div className="pt-1">
              <label className="btn btn-primary text-xs sm:text-sm py-2.5 px-5 cursor-pointer inline-flex items-center gap-2">
                <FileText size={15} />
                <span>{uploading ? 'Validating CSV…' : 'Choose CSV File'}</span>
                <input
                  type="file"
                  accept=".csv"
                  onChange={onFileChange}
                  disabled={uploading}
                  className="hidden"
                />
              </label>
            </div>
          </div>

          {error && <div className="error-text">{error}</div>}

          {preview && (
            <div className="card p-4 sm:p-6 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">
                  {preview.errors.length === 0
                    ? `Preview: ${preview.rows.length} Match Picks Ready`
                    : `Validation Failed (${preview.errors.length} error${preview.errors.length > 1 ? 's' : ''})`}
                </h2>
                {preview.bookingCode && (
                  <span className="mono text-xs text-[var(--floodlight)] bg-[rgba(245,179,53,0.1)] px-2 py-0.5 rounded">
                    Code: {preview.bookingCode}
                  </span>
                )}
              </div>

              {preview.errors.length > 0 ? (
                <div className="table-container">
                  <table className="table-responsive">
                    <thead>
                      <tr>
                        <th>Line</th>
                        <th>Error Description</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.errors.map((e, i) => (
                        <tr key={i}>
                          <td className="mono text-red-400 font-bold">{e.line}</td>
                          <td className="text-xs text-[var(--chalk-muted)]">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <>
                  <div className="table-container">
                    <table className="table-responsive">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Time</th>
                          <th>Match</th>
                          <th>Prediction Pick</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.rows.map((r) => (
                          <tr key={r.line}>
                            <td className="mono text-xs">{r.date}</td>
                            <td className="mono text-xs">{r.time}</td>
                            <td className="text-white font-medium">{r.matches}</td>
                            <td className="mono text-[var(--floodlight)] font-semibold">{r.prediction}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="field mb-0 pt-2">
                    <label htmlFor="title" className="text-xs text-[var(--chalk-muted)] font-medium">Post Title</label>
                    <input
                      id="title"
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="e.g. Saturday Mega Weekend Accumulator"
                      className="w-full text-sm"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 text-xs sm:text-sm text-white cursor-pointer py-1">
                    <input
                      type="checkbox"
                      checked={publishNow}
                      onChange={(e) => setPublishNow(e.target.checked)}
                      className="rounded border-[rgba(243,245,236,0.2)] bg-[var(--pitch)] text-[var(--floodlight)] focus:ring-[var(--floodlight)]"
                    />
                    <span>Publish live immediately to subscribers (skip draft)</span>
                  </label>

                  <div className="pt-2">
                    <button
                      onClick={confirm}
                      className="btn btn-primary w-full py-2.5 text-sm font-semibold flex items-center justify-center gap-2"
                      disabled={confirming || !title}
                    >
                      <Sparkles size={15} />
                      <span>{confirming ? 'Importing…' : `Import & Save ${preview.rows.length} Picks`}</span>
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
