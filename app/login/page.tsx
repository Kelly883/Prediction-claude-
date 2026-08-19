'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import PasswordField from '@/components/PasswordField';
import { safeRedirectPath } from '@/lib/safe-redirect';
import { apiJson } from '@/lib/api-client';

type AuthState = 'loading' | 'authenticated' | 'anonymous';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const destination = safeRedirectPath(searchParams.get('next'), '/dashboard');
  const [authState, setAuthState] = useState<AuthState>('loading');
  const [currentUser, setCurrentUser] = useState<{ email: string; role: 'admin' | 'user' | 'superadmin' } | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [challengeToken, setChallengeToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/me', { credentials: 'same-origin' })
      .then((res) => {
        if (!res.ok) throw new Error('Not authenticated');
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setCurrentUser({ email: data.email, role: data.role });
          setAuthState('authenticated');
        }
      })
      .catch(() => {
        if (!cancelled) setAuthState('anonymous');
      });
    return () => { cancelled = true; };
  }, []);

  function homeFor(role: 'admin' | 'user' | 'superadmin') {
    if (role === 'admin' || role === 'superadmin') return destination && destination.startsWith('/admin') ? destination : '/admin';
    return destination && destination.startsWith('/dashboard') ? destination : '/dashboard';
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

  async function handleSwitchAccount() {
    setLoggingOut(true);
    try {
      await apiJson('/api/auth/logout', { method: 'POST' });
      setCurrentUser(null);
      setAuthState('anonymous');
      setError(null);
      setChallengeToken(null);
      setEmail('');
      setPassword('');
      setCode('');
    } catch {
      setError('Could not sign out. Please try again.');
    } finally {
      setLoggingOut(false);
    }
  }

  if (authState === 'loading') {
    return (
      <div className="card" style={{ width: 400, maxWidth: '100%' }}>
        <p style={{ color: 'var(--chalk-muted)' }}>Checking your session…</p>
      </div>
    );
  }

  if (authState === 'authenticated' && currentUser) {
    const isAdmin = currentUser.role === 'admin' || currentUser.role === 'superadmin';
    return (
      <div className="card" style={{ width: 400, maxWidth: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 6 }}>ALREADY SIGNED IN</div>
        <h1 className="display" style={{ fontSize: 26, marginBottom: 12 }}>Welcome back</h1>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 6, wordBreak: 'break-all' }}>{currentUser.email}</p>
        <p style={{ color: 'var(--chalk-muted)', marginBottom: 20, fontSize: 13, textTransform: 'capitalize' }}>
          {isAdmin ? 'Admin account' : 'Member account'}
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <Link
            href={isAdmin ? '/admin' : '/dashboard'}
            className="btn btn-primary"
            style={{ width: '100%', textAlign: 'center' }}
          >
            Go to {isAdmin ? 'Admin Portal' : 'Account'}
          </Link>
          <button
            type="button"
            className="btn btn-ghost"
            style={{ width: '100%' }}
            disabled={loggingOut}
            onClick={handleSwitchAccount}
          >
            {loggingOut ? 'Signing out…' : 'Sign in to another account'}
          </button>
        </div>
      </div>
    );
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
