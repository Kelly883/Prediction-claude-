'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { X } from 'lucide-react';

type SessionState = { authenticated: false } | { authenticated: true; role: 'admin' | 'user' | 'superadmin' };

const MOBILE_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/football-predictions', label: 'Predictions' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/archive', label: 'Results Archive' },
  { href: '/pricing', label: 'Pricing' },
];

type MobileMenuProps = {
  isOpen: boolean;
  onClose: () => void;
  session: SessionState;
  isAdmin: boolean;
  pathname: string;
};

export default function MobileMenu({ isOpen, onClose, session, isAdmin, pathname }: MobileMenuProps) {
  const isActive = (href: string) =>
    pathname === href || (href !== '/' && pathname.startsWith(href + '/'));

  useEffect(() => {
    const handleKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      document.body.style.overflow = 'hidden';
      window.addEventListener('keydown', handleKeydown);
    }
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', handleKeydown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 64,
        left: 0,
        right: 0,
        bottom: 0,
        background: '#050805',
        zIndex: 100,
        display: 'flex',
        flexDirection: 'column',
      }}
      onClick={onClose}
    >
      <nav style={{ flex: 1, padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: 0, overflowY: 'auto' }}>
        {MOBILE_LINKS.map((link) => {
          const active = isActive(link.href);
          return (
            <Link
              key={link.href}
              href={link.href}
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{
                textDecoration: 'none',
                color: active ? '#FFFFFF' : '#D1D5DB',
                fontSize: 18,
                fontWeight: 500,
                padding: '16px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'block',
              }}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ padding: 24, borderTop: '1px solid rgba(255,255,255,0.08)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {session.authenticated ? (
          <Link
            href={isAdmin ? '/admin' : '/dashboard'}
            className="btn btn-primary"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            style={{ fontSize: 16, fontWeight: 600, padding: '16px 24px', textAlign: 'center', width: '100%' }}
          >
            {isAdmin ? 'Admin Portal' : 'My Account'}
          </Link>
        ) : (
          <>
            <Link
              href="/login"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{
                textDecoration: 'none',
                color: '#D1D5DB',
                fontSize: 16,
                fontWeight: 500,
                textAlign: 'center',
                padding: '16px 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                display: 'block',
              }}
            >
              Log in
            </Link>
            <Link
              href="/register"
              className="btn btn-primary"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              style={{ fontSize: 16, fontWeight: 600, padding: '16px 24px', textAlign: 'center', width: '100%' }}
            >
              Get started
            </Link>
          </>
        )}
      </div>
    </div>
  );
}