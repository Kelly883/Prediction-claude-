'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import PasswordField from '@/components/PasswordField';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { apiJson } from '@/lib/api-client';

type Me = { name: string; email: string; role: 'admin' | 'user' };

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

  // middleware.ts no longer silently redirects an already-authenticated
  // visitor away from /login before this page even renders — that used to
  // happen invisibly, with no indication of what happened and no way to
  // sign in as a different account short of finding logout separately.
  // Checked explicitly here instead, so it can be shown rather than hidden.
  const [existingUser, setExistingUser] = useState<Me | null | undefined>(undefined); // undefined = still checking
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    // Deliberately a plain fetch, not apiJson/apiFetch: apiFetch's global
    // 401 handling attempts a refresh and hard-redirects to /login on
    // failure — since this check runs ON /login, that would loop forever
    // for the (very common) logged-out case: 401 -> refresh fails ->
    // redirect to /login -> reload -> 401 again. This check needs to
    // handle both outcomes itself without that side effect.
    fetch('/api/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then(setExistingUser)
      .catch(() => setExistingUser(null));
  }, []);

  function homeFor(role: 'admin' | 'user') {
    if (role === 'admin') return destination && destination.startsWith('/admin') ? destination : '/admin';
    return destination && destination.startsWith('/dashboard') ? destination : '/dashboard';
  }

  async function signOutAndSwitch() {
    setLoggingOut(true);
    try {
      await apiJson('/api/auth/logout', { method: 'POST' });
    } catch {
      // Best-effort — even if this fails, showing the login form is still
      // correct: worst case, submitting new credentials just overwrites the
      // stale session with a fresh one.
    }
    setExistingUser(null);
    setLoggingOut(false);
  }

  async function onSubmitPassword(e: React.FormEvent<HTMLFormElement>) {
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

      const targetPath = homeFor(data.role);

      await router.push(targetPath);
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

      const targetPath = homeFor(data.role);

      router.push(targetPath);
      router.refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="card" style={{ width: 400, maxWidth: '100%' }}>
      {existingUser === undefined ? (
        <p style={{ color: 'var(--chalk-muted)', fontSize: 14 }}>Checking your session…</p>
      ) : existingUser ? (
        <>
          <div className="eyebrow" style={{ marginBottom: 6 }}>ALREADY SIGNED IN</div>
          <h1 className="display" style={{ fontSize: 24, marginBottom: 8 }}>{existingUser.name}</h1>
          <p style={{ color: 'var(--chalk-muted)', fontSize: 14, marginBottom: 24 }}>
            {existingUser.email} · {existingUser.role === 'admin' ? 'Admin' : 'Member'}
          </p>

          <button
            type="button"
            onClick={() => router.push(homeFor(existingUser.role))}
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 10 }}
          >
            Continue to {existingUser.role === 'admin' ? 'admin panel' : 'dashboard'}
          </button>
          <button
            type="button"
            onClick={signOutAndSwitch}
            className="btn btn-ghost"
            style={{ width: '100%' }}
            disabled={loggingOut}
          >
            {loggingOut ? 'Signing out…' : 'Not you? Log out and sign in as someone else'}
          </button>
        </>
      ) : !challengeToken ? (
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
