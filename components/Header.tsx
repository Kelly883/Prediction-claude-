'use client';

import Link from 'next/link';
import Logo from '@/components/Logo';

export default function Header() {
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
        </nav>
      </div>
    </header>
  );
}

