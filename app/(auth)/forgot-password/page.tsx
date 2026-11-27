'use client';

import { useState } from 'react';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [devLink, setDevLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setDevLink(null);
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      setMessage(data.message ?? 'If an account exists for that email, a reset link has been sent.');
      if (data.devResetUrl) setDevLink(data.devResetUrl);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
        <div className="card" style={{ width: 400, maxWidth: '100%' }}>
          <div className="eyebrow" style={{ marginBottom: 6 }}>ACCOUNT RECOVERY</div>
          <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Reset your password</h1>

          {!message ? (
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="email">Email</label>
                <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </div>
              <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          ) : (
            <div>
              <p style={{ color: 'var(--chalk-muted)', fontSize: 14, lineHeight: 1.6 }}>{message}</p>
              {devLink && (
                <p style={{ marginTop: 16, fontSize: 13 }}>
                  <span style={{ color: 'var(--card-red)' }}>Dev mode (no email provider configured):</span>{' '}
                  <a href={devLink} style={{ color: 'var(--floodlight)' }}>{devLink}</a>
                </p>
              )}
            </div>
          )}
        </div>
      </section>
      <Footer />
    </>
  );
}
