'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Logo from '@/components/Logo';
import { Menu, X } from 'lucide-react';
import MobileMenu from '@/components/MobileMenu';

type SessionState = { authenticated: false } | { authenticated: true; role: 'admin' | 'user' | 'superadmin' };

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/football-predictions', label: 'Predictions' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/archive', label: 'Results archive' },
  { href: '/pricing', label: 'Pricing' },
];

export default function Header() {
  const [session, setSession] = useState<SessionState>({ authenticated: false });
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pathname, setPathname] = useState<string>('');

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setPathname(window.location.pathname);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
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
  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href + '/'));

  const toggleMobile = useCallback(() => setMobileOpen((prev) => !prev), []);
  const closeMobile = useCallback(() => setMobileOpen(false), []);

  const navLinkStyle = (active: boolean) => ({
    textDecoration: 'none' as const,
    color: active ? '#FFFFFF' : 'var(--chalk-muted)',
    fontSize: 14,
    fontWeight: 500 as const,
    padding: '10px 14px',
    borderRadius: 8,
    display: 'block' as const,
    background: active ? 'rgba(24, 201, 100, 0.10)' : 'transparent',
  });

  const authLinkStyle = {
    fontSize: 14,
    fontWeight: 500 as const,
    textDecoration: 'none' as const,
    color: 'var(--chalk-muted)' as const,
    whiteSpace: 'nowrap' as const,
    padding: '8px 12px',
    borderRadius: 8,
  };

  return (
    <>
      <header
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          zIndex: 99,
          height: 64,
          borderBottom: '1px solid rgba(255,255,255,0.08)',
          background: '#050805',
        }}
      >
        <div
          className="container"
          style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: '100%', gap: 10 }}
        >
          <Link href="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
            <Logo size="sm" showTagline />
          </Link>

          <nav
            style={{
              alignItems: 'center',
              gap: 0,
              flexShrink: 0,
              display: 'flex',
            }}
          >
            <div className="desktop-nav">
              {NAV_LINKS.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  style={navLinkStyle(isActive(link.href))}
                >
                  {link.label}
                </Link>
              ))}
              {session.authenticated ? (
                <Link
                  href={isAdmin ? '/admin' : '/dashboard'}
                  className="btn btn-primary"
                  style={{
                    padding: '8px 16px',
                    fontSize: 13,
                    whiteSpace: 'nowrap',
                    fontWeight: 600 as const,
                    minHeight: 36,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginLeft: 10,
                  }}
                >
                  {isAdmin ? 'Admin Portal' : 'My Account'}
                </Link>
              ) : (
                <>
                  <Link href="/login" style={authLinkStyle}>
                    Log in
                  </Link>
                  <Link
                    href="/register"
                    className="btn btn-primary"
                    style={{
                      padding: '8px 16px',
                      fontSize: 13,
                      whiteSpace: 'nowrap',
                      fontWeight: 600 as const,
                      minHeight: 36,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginLeft: 10,
                    }}
                  >
                    Get started
                  </Link>
                </>
              )}
            </div>
            <button
              onClick={toggleMobile}
              aria-label={mobileOpen ? 'Close main menu' : 'Open main menu'}
              aria-expanded={mobileOpen}
              className="mobile-menu-btn"
              style={{
                display: 'none',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'none',
                border: 'none',
                color: '#FFFFFF',
                cursor: 'pointer',
                padding: 8,
              }}
            >
              {mobileOpen ? <X size={20} strokeWidth={2} /> : <Menu size={20} strokeWidth={2} />}
            </button>
          </nav>
        </div>
      </header>

      <MobileMenu isOpen={mobileOpen} onClose={closeMobile} session={session} isAdmin={isAdmin} pathname={pathname} />
    </>
  );
}