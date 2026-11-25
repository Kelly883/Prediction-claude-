'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_PERMISSIONS, type Permission } from '@/lib/permissions';

export const ADMIN_NAV_LINKS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/predictions', label: 'Predictions' },
  { href: '/admin/predictions/archive', label: 'Archive' },
  { href: '/admin/free-access', label: 'Free Access' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/admins/create', label: 'Create Admin' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/audit-logs', label: 'Audit Logs' },
  { href: '/admin/cms', label: 'CMS' },
  { href: '/admin/security', label: 'Security' },
  { href: '/superadmin/analysis', label: 'Analysis' },
  { href: '/admin/permissions', label: 'Permissions' },
  { href: '/admin/profile', label: 'Profile' },
];

type AdminNavTabsProps = {
  permissions?: Permission[];
  role?: string;
};

export default function AdminNavTabs({ permissions, role }: AdminNavTabsProps) {
  const pathname = usePathname();
  const hasNavPermission = (href: string) => {
    if (!permissions) return true;
    const required = NAV_PERMISSIONS[href];
    if (!required) return true;
    // Superadmin-only routes are visible exclusively to verified superadmins,
    // regardless of any page permission a regular admin may hold.
    if (href.startsWith('/superadmin/')) return role === 'superadmin';
    if (role === 'superadmin') return true;
    return permissions.includes(required);
  };

  const visibleLinks = ADMIN_NAV_LINKS.filter((item) => hasNavPermission(item.href));

  return (
    <nav className="admin-dash-tabs" aria-label="Admin Navigation">
      {visibleLinks.map((item) => {
        const isActive = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`admin-dash-tab ${isActive ? 'admin-dash-tab-active' : ''}`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
