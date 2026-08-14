'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import Sidebar from '@/components/Sidebar';
import { DashboardUserProvider, useDashboardUser } from '@/lib/dashboard-user-context';

const USER_LINKS = [
  { href: '/dashboard', label: 'Overview', exact: true },
  { href: '/dashboard/plans', label: 'Plans' },
  { href: '/dashboard/profile', label: 'Profile' },
  { href: '/dashboard/security', label: 'Security' },
];

function DashboardChrome({ children }: { children: React.ReactNode }) {
  const { user, loading } = useDashboardUser();
  const router = useRouter();

  useEffect(() => {
    if (!loading && user?.role === 'admin') {
      router.replace('/admin');
    }
  }, [user, loading, router]);

  if (!loading && user?.role === 'admin') {
    return (
      <div className="p-8 text-center text-sm text-[var(--chalk-muted)]">
        Redirecting to Admin Portal…
      </div>
    );
  }

  return (
    <>
      <DashboardHeader isAdmin={false} />
      <section className="section-tight">
        <div className="container dashboard-shell">
          <Sidebar title="Account" items={USER_LINKS} />
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
    </>
  );
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardUserProvider>
      <DashboardChrome>{children}</DashboardChrome>
    </DashboardUserProvider>
  );
}
