'use client';

import { useEffect, useState } from 'react';
import { apiJson } from '@/lib/api-client';

type Section = { key: string; content: { heading?: string; body?: string } };

const PAGES = ['homepage', 'faq', 'terms', 'privacy'];

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
    apiJson<Section[]>(`/api/cms/${page}`).then(setSections).finally(() => setLoading(false));
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
      setKey(''); setHeading(''); setBody('');
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

  return (
    <>
      <h1 className="display" style={{ fontSize: 28, marginBottom: 20 }}>CMS</h1>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
        {PAGES.map((p) => (
          <button key={p} onClick={() => setPage(p)} className={page === p ? 'btn btn-primary' : 'btn btn-ghost'} style={{ padding: '6px 14px', fontSize: 13, textTransform: 'capitalize' }}>
            {p}
          </button>
        ))}
      </div>

      <div className="admin-grid-half">
        <div className="card">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Sections on /{page}</h2>
          {page === 'homepage' && (
            <p style={{ fontSize: 12, color: 'var(--chalk-muted)', marginBottom: 12 }}>
              Only a section with key <span className="mono">announcement</span> renders on the homepage
              right now (as a banner). Other keys are saved but not yet displayed anywhere.
            </p>
          )}
          {loading ? <p>Loading…</p> : sections.length === 0 ? (
            <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>No sections yet — add one.</p>
          ) : (
            <div style={{ display: 'grid', gap: 8 }}>
              {sections.map((s) => (
                <button key={s.key} onClick={() => editSection(s)} className="btn btn-ghost" style={{ textAlign: 'left', justifyContent: 'flex-start', fontSize: 13 }}>
                  <span className="mono">{s.key}</span> — {s.content.heading || '(no heading)'}
                </button>
              ))}
            </div>
          )}
        </div>

        <form onSubmit={save} className="card">
          <h2 style={{ fontSize: 16, marginBottom: 12 }}>Edit section</h2>
          <div className="field">
            <label htmlFor="key">Key (used to identify this block)</label>
            <input id="key" required value={key} onChange={(e) => setKey(e.target.value)} placeholder="intro" />
          </div>
          <div className="field">
            <label htmlFor="heading">Heading</label>
            <input id="heading" value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="1. Introduction" />
          </div>
          <div className="field">
            <label htmlFor="body">Body</label>
            <textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={8}
              style={{ background: 'var(--pitch)', border: '1px solid rgba(243,245,236,0.14)', borderRadius: 4, padding: '12px 14px', color: 'var(--chalk)', fontFamily: 'inherit', fontSize: 14 }}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save section'}</button>
        </form>
      </div>
    </>
  );
}
