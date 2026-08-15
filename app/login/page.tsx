'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PasswordField from '@/components/PasswordField';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { safeRedirectPath } from '@/lib/safe-redirect';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeRedirectPath(searchParams.get('next'), '/dashboard');

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Couldn't log you in");

      if (data.requiresTwoFactor) {
        setChallengeToken(data.challengeToken);
        return;
      }

      router.push(destination);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function onSubmitCode(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch('/api/auth/2fa/login-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challengeToken, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? 'Invalid code');
      router.push(destination);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ width: 400, maxWidth: '100%' }}>
      {!challengeToken ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>WELCOME BACK</div>
          <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Log in</h1>

          <form onSubmit={onSubmitPassword}>
            <div className="field">
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            </div>
            <PasswordField id="password" label="Password" value={password} onChange={setPassword} placeholder="••••••••" autoComplete="current-password" />

            {error && <div className="error-text">{error}</div>}

            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Logging in…' : 'Log in'}
            </button>
          </form>

          <p style={{ marginTop: 20, fontSize: 14, color: 'var(--chalk-muted)' }}>
            No account yet? <Link href="/register" style={{ color: 'var(--floodlight)' }}>Sign up</Link>
          </p>
          <p style={{ marginTop: 8, fontSize: 14, color: 'var(--chalk-muted)' }}>
            <Link href="/forgot-password" style={{ color: 'var(--floodlight)' }}>Forgot your password?</Link>
          </p>
        </>
      ) : (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>TWO-FACTOR CODE</div>
          <h1 className="display" style={{ fontSize: 26, marginBottom: 24 }}>Enter your code</h1>
          <form onSubmit={onSubmitCode}>
            <div className="field">
              <label htmlFor="code">6-digit code from your authenticator app</label>
              <input id="code" inputMode="numeric" required autoFocus value={code} onChange={(e) => setCode(e.target.value)} placeholder="123456" />
            </div>
            {error && <div className="error-text">{error}</div>}
            <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={loading}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </form>
        </>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <>
      <Header />
      <section className="section" style={{ display: 'flex', justifyContent: 'center' }}>
        <Suspense fallback={<div className="card" style={{ width: 400 }}>Loading…</div>}>
          <LoginForm />
        </Suspense>
      </section>
      <Footer />
    </>
  );
}
