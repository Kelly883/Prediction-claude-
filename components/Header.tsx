'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';

type SessionState = { authenticated: false } | { authenticated: true; role: 'admin' | 'user' | 'superadmin' };

export default function Header() {
  // Defaults to the logged-out state rather than a loading spinner — most
  // homepage visitors aren't logged in, and flashing a spinner first would
  // be a worse experience for the common case just to handle the less
  // common one. Flips over once the check resolves, for the people it
  // actually matters for.
  const [session, setSession] = useState<SessionState>({ authenticated: false });

  useEffect(() => {
    let cancelled = false;
    // Plain fetch, not apiJson/apiFetch: same reasoning as login's own
    // session check — apiFetch's global 401 handling would attempt a
    // refresh and could redirect on failure, which has no place in a
    // header component that renders on every single page including ones
    // an anonymous visitor is on. This check should only ever update local
    // state, never navigate anywhere on its own.
    fetch('/api/me', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled && data) setSession({ authenticated: true, role: data.role });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const isAdmin = session.authenticated && (session.role === 'admin' || session.role === 'superadmin');

  return (
    <header style={{ borderBottom: '1px solid rgba(243,245,236,0.14)', background: 'var(--pitch-dark, #0b2216)' }}>
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 64,
          gap: 10,
        }}
      >
        <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          <Logo size="sm" />
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {session.authenticated ? (
            <Link
              href={isAdmin ? '/admin' : '/dashboard'}
              className="btn btn-primary"
              style={{
                padding: '7px 14px',
                fontSize: 13,
                whiteSpace: 'nowrap',
                fontWeight: 600,
                minHeight: 36,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {isAdmin ? 'Admin Portal' : 'My Account'}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                style={{
                  fontSize: 13,
                  fontWeight: 500,
                  textDecoration: 'none',
                  color: 'var(--chalk-muted)',
                  whiteSpace: 'nowrap',
                  padding: '6px 6px',
                }}
              >
                Log in
              </Link>
              <Link
                href="/register"
                className="btn btn-primary"
                style={{
                  padding: '7px 14px',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                  fontWeight: 600,
                  minHeight: 36,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                Sign up
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}

