'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import Sidebar from '@/components/Sidebar';
import { DashboardUserProvider, useDashboardUser } from '@/lib/dashboard-user-context';

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

function AdminChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useDashboardUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user && user.role !== 'admin') {
      router.replace('/dashboard');
    }
  }, [user, loading, router]);

  if (!loading && user && user.role !== 'admin') {
    return (
      <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
        Redirecting to Member Dashboard…
      </div>
    );
  }

  return (
    <>
      <DashboardHeader isAdmin />
      <section className="section-tight">
        <div className="container dashboard-shell">
          <Sidebar title="Admin" items={ADMIN_LINKS} />
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === '/admin/setup') {
    return <>{children}</>;
  }

  return (
    <DashboardUserProvider>
      <AdminChrome>{children}</AdminChrome>
    </DashboardUserProvider>
  );
}
