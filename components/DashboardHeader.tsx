'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Logo from './Logo';
import { useDashboardUser } from '@/lib/dashboard-user-context';
import { apiFetch } from '@/lib/api-client';

export default function DashboardHeader({ isAdmin: propIsAdmin }: { isAdmin?: boolean } = {}) {
  const { user } = useDashboardUser();
  const isAdmin = propIsAdmin ?? (user?.role === 'admin');
  const pathname = usePathname();
  const inAdmin = pathname.startsWith('/admin');

  async function logout() {
    await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
    window.location.href = '/login';
  }

  return (
    <header style={{ borderBottom: '1px solid rgba(243,245,236,0.14)', background: 'var(--pitch-dark, #0b2216)', width: '100%' }}>
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          height: 60,
          gap: 8,
          flexWrap: 'nowrap',
        }}
      >
        <Link
          href={isAdmin && inAdmin ? '/admin' : '/dashboard'}
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', flexShrink: 0, minWidth: 0 }}
        >
          <Logo size="sm" adminBadge={isAdmin} />
        </Link>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <Link
            href="/dashboard"
            style={{
              fontSize: 12,
              fontWeight: 500,
              textDecoration: 'none',
              color: !inAdmin ? 'var(--floodlight)' : 'var(--chalk-muted)',
              whiteSpace: 'nowrap',
              padding: '6px 8px',
              borderRadius: 4,
              background: !inAdmin ? 'rgba(245, 179, 53, 0.12)' : 'transparent',
            }}
          >
            Dashboard
          </Link>
          {isAdmin && (
            <Link
              href="/admin"
              style={{
                fontSize: 12,
                fontWeight: 600,
                textDecoration: 'none',
                color: inAdmin ? 'var(--floodlight)' : 'var(--chalk-muted)',
                whiteSpace: 'nowrap',
                padding: '6px 8px',
                borderRadius: 4,
                background: inAdmin ? 'rgba(245, 179, 53, 0.12)' : 'transparent',
              }}
            >
              Admin
            </Link>
          )}
          <button
            onClick={logout}
            className="btn btn-ghost"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              whiteSpace: 'nowrap',
              minHeight: 30,
              height: 30,
            }}
          >
            Log out
          </button>
        </nav>
      </div>
    </header>
  );
}

export { DashboardHeader };
