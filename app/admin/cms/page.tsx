'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { FileEdit, Layers, Save, Plus, Info } from 'lucide-react';

type Section = { key: string; content: { heading?: string; body?: string } };

const PAGES = [
  { id: 'homepage', label: 'Home Page' },
  { id: 'faq', label: 'FAQ' },
  { id: 'terms', label: 'Terms of Service' },
  { id: 'privacy', label: 'Privacy Policy' },
];

export default function AdminCmsPage() {
  const [page, setPage] = useState('terms');
  const [sections, setSections] = useState<Section[]>([]);
  const [key, setKey] = useState('');
  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    setLoading(true);
    apiJson<Section[]>(`/api/cms/${page}`)
      .then(setSections)
      .finally(() => setLoading(false));
  }
  useEffect(load, [page]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await apiJson(`/api/admin/cms/${page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, content: { heading, body } }),
      });
      setKey('');
      setHeading('');
      setBody('');
      load();
    } finally {
      setSaving(false);
    }
  }

  function editSection(s: Section) {
    setKey(s.key);
    setHeading(s.content.heading ?? '');
    setBody(s.content.body ?? '');
  }

  function resetForm() {
    setKey('');
    setHeading('');
    setBody('');
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="admin-page-header">
        <div className="admin-page-eyebrow">Content Management System</div>
        <h1 className="admin-page-title">Content Management System</h1>
        <p className="admin-page-subtitle">Customize content sections, announcement banners, legal policies, and FAQ articles.</p>
        <div className="admin-underline" />
      </div>

      {/* Page Selector Tabs */}
      <div className="flex items-center gap-2 flex-wrap">
        {PAGES.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setPage(p.id);
              resetForm();
            }}
            className={`text-xs sm:text-sm py-2 px-3.5 rounded-lg font-medium transition-all min-h-[38px] ${
              page === p.id
                ? 'bg-[var(--floodlight)] text-[var(--pitch)] font-semibold shadow-sm'
                : 'bg-[var(--turf)] text-[var(--chalk-muted)] hover:text-white border border-[rgba(243,245,236,0.1)]'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="admin-grid-2col">
        {/* Sections List */}
        <div className="card p-4 sm:p-5">
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>Configured Blocks</h2>
            </div>
            <button
              onClick={resetForm}
              className="text-xs text-[var(--floodlight)] hover:underline inline-flex items-center gap-1"
            >
              <Plus size={12} />
              <span>New Block</span>
            </button>
          </div>

          {page === 'homepage' && (
            <div className="p-3 mb-4 rounded-lg bg-[var(--pitch)] border border-[rgba(245,179,53,0.2)] text-xs text-[var(--chalk-muted)] flex items-start gap-2">
              <Info size={14} className="text-[var(--floodlight)] shrink-0 mt-0.5" />
              <span>
                Note: A block with key <code className="mono text-white">announcement</code> renders as the top announcement banner on the public home page.
              </span>
            </div>
          )}

          {loading ? (
            <div className="admin-loading">Loading sections…</div>
          ) : sections.length === 0 ? (
            <div className="admin-empty-state">
              <FileEdit size={24} className="admin-empty-state-icon" />
              <p className="admin-empty-state-title">No custom sections yet</p>
              <p className="admin-empty-state-desc">Fill the form on the right to publish content for /{page}.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {sections.map((s) => {
                const isSelected = key === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => editSection(s)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-[var(--pitch)] border-[var(--floodlight)] text-white shadow-sm'
                        : 'bg-[var(--pitch)] border-[rgba(243,245,236,0.08)] text-[var(--chalk-muted)] hover:text-white hover:border-[rgba(243,245,236,0.2)]'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="mono text-xs font-semibold text-[var(--floodlight)]">
                        {s.key}
                      </span>
                      {isSelected && (
                        <span className="text-[10px] uppercase font-bold text-[var(--floodlight)] bg-[rgba(245,179,53,0.15)] px-1.5 py-0.5 rounded">
                          Editing
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-medium text-white truncate">
                      {s.content.heading || '(No heading)'}
                    </div>
                    {s.content.body && (
                      <div className="text-[11px] text-[var(--chalk-muted)] line-clamp-2 mt-0.5">
                        {s.content.body}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Section Edit Form */}
        <form onSubmit={save} className="card p-4 sm:p-5 flex flex-col gap-4">
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <FileEdit size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>{key ? `Edit "${key}" Block` : 'Create Section Block'}</h2>
            </div>
          </div>

          <div className="admin-form-group">
            <label htmlFor="key" className="admin-form-label">Section Key (unique identifier)</label>
            <input
              id="key"
              required
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="e.g. hero_heading, intro, announcement"
              className="admin-input mono-text"
            />
          </div>

          <div className="admin-form-group">
            <label htmlFor="heading" className="admin-form-label">Section Heading (optional)</label>
            <input
              id="heading"
              value={heading}
              onChange={(e) => setHeading(e.target.value)}
              placeholder="e.g. 1. Terms &amp; Conditions Overview"
              className="admin-input"
            />
          </div>

          <div className="admin-form-group">
            <label htmlFor="body" className="admin-form-label">Content Body (Markdown / Plaintext)</label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              placeholder="Enter markdown copy or HTML description text here…"
              className="admin-textarea"
            />
          </div>

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary py-2.5 px-5 text-sm font-semibold flex-1 sm:flex-initial"
              disabled={saving || !key}
            >
              <Save size={14} />
              <span>{saving ? 'Saving…' : 'Save Section'}</span>
            </button>
            {key && (
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-ghost py-2.5 px-4 text-sm"
              >
                Clear
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
