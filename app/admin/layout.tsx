'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import DashboardHeader from '@/components/DashboardHeader';
import AdminNavTabs from '@/components/AdminNavTabs';
import { DashboardUserProvider, useDashboardUser } from '@/lib/dashboard-user-context';

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
        <div className="container admin-overview-shell">
          <div className="admin-nav-tabs-wrapper mb-5">
            <AdminNavTabs />
          </div>
          <div className="dashboard-content">{children}</div>
        </div>
      </section>
    </>
  );
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardUserProvider>
      <AdminChrome>{children}</AdminChrome>
    </DashboardUserProvider>
  );
}
