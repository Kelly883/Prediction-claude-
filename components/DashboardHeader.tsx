'use client';

import Link from 'next/link';
import { useRouter, usePathname } from 'next/navigation';
import Logo from '@/components/Logo';
import { ShieldCheck, User, LogOut, ArrowUpRight } from 'lucide-react';

export default function DashboardHeader({ isAdmin = false }: { isAdmin?: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const inAdmin = pathname.startsWith('/admin');

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
    router.refresh();
  }

  return (
    <header className="dashboard-header-root">
      <div className="container dashboard-header-container">
        {/* Brand Logo - Links to /admin when in admin portal, else /dashboard */}
        <Link
          href={inAdmin ? '/admin' : '/dashboard'}
          className="dashboard-header-brand"
          title={inAdmin ? 'Go to Admin Overview' : 'Go to Member Dashboard'}
        >
          <Logo size="sm" adminBadge={inAdmin || isAdmin} />
        </Link>

        {/* Navigation Bar */}
        <nav className="dashboard-header-nav">
          {inAdmin ? (
            /* Inside Admin Portal - pure admin view */
            <div
              className="dashboard-nav-item dashboard-nav-item-active"
              title="Admin Dashboard"
            >
              <ShieldCheck size={14} className="dashboard-nav-icon" />
              <span>Admin Portal</span>
            </div>
          ) : (
            /* Inside Member Dashboard - pure member view */
            <div
              className="dashboard-nav-item dashboard-nav-item-active"
              title="Member Dashboard"
            >
              <User size={14} className="dashboard-nav-icon" />
              <span>Member Dashboard</span>
            </div>
          )}

          <button
            onClick={logout}
            className="dashboard-logout-btn"
            title="Sign out of your account"
            aria-label="Log out"
          >
            <LogOut size={13} />
            <span className="logout-text">Log out</span>
          </button>
        </nav>
      </div>
    </header>
  );
}

