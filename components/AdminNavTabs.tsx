'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { NAV_PERMISSIONS, type Permission } from '@/lib/permissions';

export const ADMIN_NAV_LINKS = [
  { href: '/admin', label: 'Overview', exact: true },
  { href: '/admin/plans', label: 'Plans' },
  { href: '/admin/predictions', label: 'Predictions' },
  { href: '/admin/free-access', label: 'Free Access' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/admins/create', label: 'Create Admin' },
  { href: '/admin/transactions', label: 'Transactions' },
  { href: '/admin/audit-logs', label: 'Audit Logs' },
  { href: '/admin/cms', label: 'CMS' },
  { href: '/admin/security', label: 'Security' },
  { href: '/admin/permissions', label: 'Permissions' },
];

type AdminNavTabsProps = {
  permissions?: Permission[];
};

export default function AdminNavTabs({ permissions }: AdminNavTabsProps) {
  const pathname = usePathname();
  const hasPermission = (href: string) => {
    if (!permissions) return true;
    const required = NAV_PERMISSIONS[href];
    if (!required) return true;
    return permissions.includes(required);
  };

  const visibleLinks = ADMIN_NAV_LINKS.filter((item) => hasPermission(item.href));

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
