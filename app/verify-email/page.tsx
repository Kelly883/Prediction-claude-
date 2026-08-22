'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Header from '@/components/Header';
import Footer from '@/components/Footer';

type Status = 'loading' | 'success' | 'expired' | 'invalid' | 'already_verified' | 'missing';

function ResendForm({ email }: { email: string }) {
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
        <input id="resendEmail" type="email" required value={email} onChange={(e) => {}} placeholder="you@example.com" readOnly />
      </div>
      <button type="submit" className="btn btn-ghost" style={{ width: '100%' }} disabled={sending}>
        {sending ? 'Sending…' : 'Resend verification email'}
      </button>
    </form>
  );
}

function EmailResendForm() {
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
        <label htmlFor="resendEmail">Email address</label>
        <input id="resendEmail" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
      </div>
      <button type="submit" className="btn btn-ghost" style={{ width: '100%' }} disabled={sending}>
        {sending ? 'Sending…' : 'Send verification link'}
      </button>
    </form>
  );
}

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const [status, setStatus] = useState<Status>(token ? 'loading' : 'missing');
  const [message, setMessage] = useState<string>('');
  const [email, setEmail] = useState<string>('');

  // eslint-disable-next-line react-hooks/set-state-in-effect
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
        if (!res.ok) {
          if (data.alreadyVerified) {
            if (!cancelled) {
              setStatus('already_verified');
              setMessage(data.message ?? 'Your email is already verified.');
            }
            return;
          }
          if (data.reason === 'expired') {
            if (!cancelled) {
              setStatus('expired');
              setMessage(data.error ?? 'This verification link has expired. Please request a new one.');
              if (data.email) setEmail(data.email);
            }
            return;
          }
          if (!cancelled) {
            setStatus('invalid');
            setMessage(data.error ?? 'This link is invalid or has already been used.');
            if (data.email) setEmail(data.email);
          }
          return;
        }
        if (!cancelled) {
          setStatus('success');
          setMessage(data.message ?? 'Email verified successfully.');
        }
      } catch (err) {
        if (!cancelled) {
          setStatus('invalid');
          setMessage('This link is invalid or has already been used.');
        }
      }
    }

    verify();
    return () => { cancelled = true; };
  }, [token]);

  if (status === 'missing') {
    return (
      <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
        <h2 className="display" style={{ fontSize: 24, marginBottom: 12 }}>Need a verification link?</h2>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 20, fontSize: 14 }}>
          Enter your email address and we'll send you a new verification email.
        </p>
        <EmailResendForm />
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

  const isSuccess = status === 'success' || status === 'already_verified';
  const showResend = ['expired', 'invalid', 'missing'].includes(status);

  return (
    <div className="card" style={{ maxWidth: 480, margin: '0 auto', textAlign: 'center' }}>
      <h2 className="display" style={{ fontSize: 24, marginBottom: 12, color: isSuccess ? 'var(--floodlight)' : 'var(--card-red)' }}>
        {status === 'success' && 'Email verified'}
        {status === 'already_verified' && 'Email already verified'}
        {status === 'expired' && 'Link expired'}
        {status === 'invalid' && 'Invalid link'}
      </h2>
      <p style={{ color: 'var(--chalk-muted)', marginBottom: 20 }}>{message}</p>
      {isSuccess ? (
        <a href="/login" className="btn btn-primary">Continue to login</a>
      ) : showResend && email ? (
        <>
          <a href="/login" className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }}>Go to login</a>
          <ResendForm email={email} />
        </>
      ) : showResend ? (
        <a href="/login" className="btn btn-primary">Go to login</a>
      ) : null}
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
