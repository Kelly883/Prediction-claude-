'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

type Status = 'loading' | 'success' | 'error' | 'missing';

function ResendForm() {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSending(true);
    try {
      await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setSent(true);
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return <p style={{ color: 'var(--floodlight)', fontSize: 14, marginTop: 16 }}>If that email has an account, a new link is on its way.</p>;
  }

  return (
    <form onSubmit={onSubmit} style={{ marginTop: 16, textAlign: 'left' }}>
      <div className="field">
        <label htmlFor="resendEmail">Get a new verification link</label>
        <input id="resendEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <button type="submit" className="btn btn-ghost" style={{ width: '100%' }} disabled={sending}>
        {sending ? 'Sending…' : 'Resend verification email'}
      </button>
    </form>
  );
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>(token ? 'loading' : 'missing');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    if (!token) {
      setStatus('missing');
      setMessage('No verification token provided.');
      return;
    }

    let cancelled = false;
    async function verify() {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? 'Verification failed');
        if (!cancelled) {
          setStatus('success');
          setMessage(data.message ?? 'Email verified successfully.');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('error');
          setMessage((err as Error).message);
        }
      }
    }

    verify();
    return () => { cancelled = true; };
  }, [token]);

  if (status === 'missing') {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2 className="display" style={{ fontSize: 24, marginBottom: 12 }}>Missing token</h2>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <p style={{ color: 'var(--chalk-muted)' }}>Verifying your email…</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <h2 className="display" style={{ fontSize: 24, marginBottom: 12, color: status === 'success' ? 'var(--floodlight)' : 'var(--card-red)' }}>
        {status === 'success' ? 'Email verified' : 'Verification failed'}
      </h2>
      <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
      {status === 'success' ? (
        <a href="/login" className="btn btn-primary">Continue to login</a>
      ) : (
        <>
          <a href="/login" className="btn btn-primary" style={{ width: '100%' }}>Go to login</a>
          <ResendForm />
        </>
      )}
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <>
      <Header />
      <section className="section" style={{ paddingBottom: 56 }}>
        <div className="container">
          <Suspense fallback={<div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}><p>Loading…</p></div>}>
            <VerifyContent />
          </Suspense>
        </div>
      </section>
      <Footer />
    </>
  );
}
