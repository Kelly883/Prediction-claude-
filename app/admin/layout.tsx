'use client';

import { usePathname } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import Sidebar from '@/components/Sidebar';
import { DashboardUserProvider } from '@/lib/dashboard-user-context';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/predictions', label: 'Predictions' },
  { href: '/admin/free-access', label: 'Free access' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/audit-logs', label: 'Audit log' },
  { href: '/admin/cms', label: 'CMS' },
];

// middleware.ts already redirects non-admins away from /admin/* before this
// ever renders, so `isAdmin` here is a display concern, not a security
// boundary — the real one is requireAdmin() on every underlying API route.
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/admin/setup') {
    return <>{children}</>;
  }

  return (
    <DashboardUserProvider>
      <DashboardHeader isAdmin />
      <section className="section-tight">
        <div className="container dashboard-shell">
          <Sidebar title="Admin" items={ADMIN_LINKS} />
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
    </DashboardUserProvider>
  );
}
