'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { apiJson } from '@/lib/api-client';
import { useHasPermission } from '@/lib/use-permissions';
import { PERMISSIONS } from '@/lib/permissions';
import { FileEdit, Layers, Save, Plus, Info, Pencil, Trash2, ArrowUp, ArrowDown } from 'lucide-react';

type SectionContent = { heading?: string; body?: string; order?: number; enabled?: boolean };
type Section = { key: string; content: SectionContent };

const PAGES = [
  { id: 'homepage', label: 'Home Page' },
  { id: 'faq', label: 'FAQ' },
  { id: 'terms', label: 'Terms of Service' },
  { id: 'privacy', label: 'Privacy Policy' },
];

const KEY_PATTERN = /^[a-z0-9_]+$/;

export default function AdminCmsPage() {
  const canEditCms = useHasPermission(PERMISSIONS.pages.cms);

  const [page, setPage] = useState('terms');
  const [sections, setSections] = useState<Section[]>([]);
  const [key, setKey] = useState('');
  const [heading, setHeading] = useState('');
  const [body, setBody] = useState('');
  const [editingKey, setEditingKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const ordered = useMemo(() => {
    return [...sections].sort((a, b) => {
      const ao = typeof a.content.order === 'number' ? a.content.order : Number.MAX_SAFE_INTEGER;
      const bo = typeof b.content.order === 'number' ? b.content.order : Number.MAX_SAFE_INTEGER;
      if (ao !== bo) return ao - bo;
      return a.key.localeCompare(b.key);
    });
  }, [sections]);

  function load() {
    setLoading(true);
    apiJson<Section[]>(`/api/cms/${page}`)
      .then(setSections)
      .finally(() => setLoading(false));
  }
  useEffect(load, [page]);

  // Auto-expand the content textarea as the user types.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  function resetForm() {
    setError('');
    setSuccess('');
    setKey('');
    setHeading('');
    setBody('');
    setEditingKey('');
  }

  function editSection(s: Section) {
    setError('');
    setSuccess('');
    setEditingKey(s.key);
    setKey(s.key);
    setHeading(s.content.heading ?? '');
    setBody(s.content.body ?? '');
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setSuccess('');

    const k = key.trim();
    if (!k) return setError('Section Key is required.');
    if (!KEY_PATTERN.test(k)) {
      return setError('Section Key must use lowercase letters, numbers and underscores only (no spaces).');
    }
    if (k !== editingKey && sections.some((s) => s.key === k)) {
      return setError(`A block with key "${k}" already exists on this page.`);
    }
    if (!heading.trim()) return setError('Section Heading is required.');
    if (!body.trim()) return setError('Content Body is required.');

    setSaving(true);
    try {
      const existing = sections.find((s) => s.key === editingKey);
      const nextOrder = existing?.content.order ?? ordered.length;
      await apiJson(`/api/admin/cms/${page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          key: k,
          content: {
            heading: heading.trim(),
            body: body.trim(),
            order: nextOrder,
            enabled: existing?.content.enabled ?? true,
          },
        }),
      });
      // Renaming a block: remove the old key after the new one is written.
      if (editingKey && editingKey !== k) {
        await apiJson(`/api/admin/cms/${page}?key=${encodeURIComponent(editingKey)}`, { method: 'DELETE' });
      }
      setSuccess(`Saved "${k}".`);
      resetForm();
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save section.');
    } finally {
      setSaving(false);
    }
  }

  async function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= ordered.length) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const reordered = [...ordered];
      [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
      await Promise.all(
        reordered.map((s, i) =>
          apiJson(`/api/admin/cms/${page}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: s.key, content: { ...s.content, order: i } }),
          }),
        ),
      );
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder blocks.');
    } finally {
      setBusy(false);
    }
  }

  async function toggle(s: Section) {
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      const nextEnabled = s.content.enabled === false;
      await apiJson(`/api/admin/cms/${page}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: s.key, content: { ...s.content, enabled: nextEnabled } }),
      });
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update visibility.');
    } finally {
      setBusy(false);
    }
  }

  async function remove(s: Section) {
    if (!window.confirm('Are you sure you want to delete this block?')) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await apiJson(`/api/admin/cms/${page}?key=${encodeURIComponent(s.key)}`, { method: 'DELETE' });
      if (editingKey === s.key) resetForm();
      setSuccess(`Deleted "${s.key}".`);
      load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete block.');
    } finally {
      setBusy(false);
    }
  }

  const actionsDisabled = !canEditCms || busy || saving;

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
        <div className="card p-4 sm:p-5" style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <Layers size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>Configured Blocks</h2>
            </div>
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-[var(--floodlight)] hover:underline inline-flex items-center gap-1 disabled:opacity-50"
              disabled={!canEditCms}
            >
              <Plus size={12} />
              <span>Add New Block</span>
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

          {error && !saving && (
            <div className="p-3 mb-3 rounded-lg bg-[rgba(239,68,68,0.12)] border border-[rgba(239,68,68,0.4)] text-sm text-[#fca5a5]">
              {error}
            </div>
          )}

          {loading ? (
            <div className="admin-loading">Loading sections…</div>
          ) : ordered.length === 0 ? (
            <div className="admin-empty-state">
              <FileEdit size={24} className="admin-empty-state-icon" />
              <p className="admin-empty-state-title">No custom sections yet</p>
              <p className="admin-empty-state-desc">Click “Add New Block” to publish content for /{page}.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {ordered.map((s, index) => {
                const isSelected = editingKey === s.key;
                const enabled = s.content.enabled !== false;
                return (
                  <div
                    key={s.key}
                    onClick={() => editSection(s)}
                    className={`w-full text-left p-3 rounded-lg border transition-all flex flex-col gap-2 ${
                      isSelected
                        ? 'bg-[var(--pitch)] border-[var(--floodlight)] text-white shadow-sm'
                        : 'bg-[var(--pitch)] border-[rgba(243,245,236,0.08)] text-[var(--chalk-muted)] hover:text-white hover:border-[rgba(243,245,236,0.2)]'
                    }`}
                    style={{ maxWidth: '100%', boxSizing: 'border-box', overflowWrap: 'anywhere', cursor: canEditCms ? 'pointer' : 'default', opacity: enabled ? 1 : 0.6 }}
                  >
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <span className="mono text-xs font-semibold text-[var(--floodlight)]" style={{ overflowWrap: 'anywhere' }}>
                        {s.key}
                      </span>
                      <span className="flex items-center gap-2">
                        {!enabled && (
                          <span className="text-[10px] uppercase font-bold text-[var(--chalk-muted)] bg-[rgba(243,245,236,0.1)] px-1.5 py-0.5 rounded">
                            Hidden
                          </span>
                        )}
                        {isSelected && (
                          <span className="text-[10px] uppercase font-bold text-[var(--floodlight)] bg-[rgba(245,179,53,0.15)] px-1.5 py-0.5 rounded">
                            Editing
                          </span>
                        )}
                      </span>
                    </div>

                    <div className="text-xs font-medium text-white" style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>
                      {s.content.heading || '(No heading)'}
                    </div>

                    {s.content.body && (
                      <div className="text-[11px] text-[var(--chalk-muted)]" style={{ overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }}>
                        {s.content.body}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex items-center gap-1.5 flex-wrap pt-1" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => editSection(s)}
                        disabled={actionsDisabled}
                        className="text-[11px] px-2 py-1 rounded-md bg-[var(--turf)] text-[var(--chalk)] hover:text-white border border-[rgba(243,245,236,0.1)] disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <Pencil size={12} /> Edit
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, -1)}
                        disabled={actionsDisabled || index === 0}
                        className="text-[11px] px-2 py-1 rounded-md bg-[var(--turf)] text-[var(--chalk)] hover:text-white border border-[rgba(243,245,236,0.1)] disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        <ArrowUp size={12} /> Up
                      </button>
                      <button
                        type="button"
                        onClick={() => move(index, 1)}
                        disabled={actionsDisabled || index === ordered.length - 1}
                        className="text-[11px] px-2 py-1 rounded-md bg-[var(--turf)] text-[var(--chalk)] hover:text-white border border-[rgba(243,245,236,0.1)] disabled:opacity-40 inline-flex items-center gap-1"
                      >
                        <ArrowDown size={12} /> Down
                      </button>
                      <button
                        type="button"
                        onClick={() => toggle(s)}
                        disabled={actionsDisabled}
                        className="text-[11px] px-2 py-1 rounded-md bg-[var(--turf)] text-[var(--chalk)] hover:text-white border border-[rgba(243,245,236,0.1)] disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <span
                          className="inline-block rounded-full"
                          style={{ width: 22, height: 12, background: enabled ? 'var(--floodlight)' : 'rgba(243,245,236,0.25)', position: 'relative' }}
                        >
                          <span
                            className="absolute rounded-full"
                            style={{ width: 8, height: 8, top: 2, left: enabled ? 12 : 2, background: '#0b2216', transition: 'left .15s' }}
                          />
                        </span>
                        {enabled ? 'Visible' : 'Hidden'}
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(s)}
                        disabled={actionsDisabled}
                        className="text-[11px] px-2 py-1 rounded-md bg-[rgba(239,68,68,0.12)] text-[#fca5a5] hover:bg-[rgba(239,68,68,0.2)] border border-[rgba(239,68,68,0.3)] disabled:opacity-50 inline-flex items-center gap-1 ml-auto"
                      >
                        <Trash2 size={12} /> Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {!loading && ordered.length > 0 && (
            <button
              type="button"
              onClick={resetForm}
              disabled={!canEditCms}
              className="mt-3 w-full py-2.5 rounded-lg border border-dashed border-[rgba(243,245,236,0.2)] text-sm text-[var(--floodlight)] hover:border-[var(--floodlight)] disabled:opacity-50 inline-flex items-center justify-center gap-1.5"
            >
              <Plus size={14} /> Add New Block
            </button>
          )}
        </div>

        {/* Section Edit Form */}
        <form onSubmit={save} className="card p-4 sm:p-5 flex flex-col gap-4" style={{ minWidth: 0, maxWidth: '100%', boxSizing: 'border-box' }}>
          <div className="admin-card-header">
            <div className="flex items-center gap-2">
              <FileEdit size={16} className="text-[var(--floodlight)]" />
              <h2 className="admin-card-title" style={{ margin: 0 }}>
                {editingKey ? `Edit "${editingKey}" Block` : 'Create Section Block'}
              </h2>
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
            <p className="text-[11px] text-[var(--chalk-muted)] mt-1">Lowercase letters, numbers and underscores only. No spaces.</p>
          </div>

          <div className="admin-form-group">
            <label htmlFor="heading" className="admin-form-label">Section Heading</label>
            <input
              id="heading"
              required
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
              ref={bodyRef}
              required
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={6}
              placeholder="Enter markdown copy or HTML description text here…"
              className="admin-textarea"
              style={{ overflow: 'hidden' }}
            />
          </div>

          {success && (
            <div className="p-3 rounded-lg bg-[rgba(16,185,129,0.12)] border border-[rgba(16,185,129,0.4)] text-sm text-[#6ee7b7]">
              {success}
            </div>
          )}
          {!canEditCms && (
            <div className="p-3 rounded-lg bg-[var(--pitch)] border border-[rgba(245,179,53,0.2)] text-xs text-[var(--chalk-muted)]">
              You do not have permission to edit the CMS. Saving is disabled.
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <button
              type="submit"
              className="btn btn-primary py-2.5 px-5 text-sm font-semibold flex-1 sm:flex-initial"
              disabled={saving || !key || !canEditCms}
            >
              <Save size={14} />
              <span>{saving ? 'Saving…' : editingKey ? 'Save Changes' : 'Save Section'}</span>
            </button>
            {(key || editingKey) && canEditCms && (
              <button
                type="button"
                onClick={resetForm}
                className="btn btn-ghost py-2.5 px-4 text-sm"
              >
                Cancel
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}