export const PERMISSIONS = {
  pages: {
    overview: 'pages.overview',
    predictions: 'pages.predictions',
    plans: 'pages.plans',
    freeAccess: 'pages.freeAccess',
    users: 'pages.users',
    transactions: 'pages.transactions',
    auditLogs: 'pages.auditLogs',
    cms: 'pages.cms',
    security: 'pages.security',
  },
  admin: {
    createAdmins: 'admin.createAdmins',
    grantPermissions: 'admin.grantPermissions',
  },
} as const;

export type Permission = 
  | typeof PERMISSIONS.pages.overview
  | typeof PERMISSIONS.pages.predictions
  | typeof PERMISSIONS.pages.plans
  | typeof PERMISSIONS.pages.freeAccess
  | typeof PERMISSIONS.pages.users
  | typeof PERMISSIONS.pages.transactions
  | typeof PERMISSIONS.pages.auditLogs
  | typeof PERMISSIONS.pages.cms
  | typeof PERMISSIONS.pages.security
  | typeof PERMISSIONS.admin.createAdmins
  | typeof PERMISSIONS.admin.grantPermissions;

export const ALL_PERMISSIONS: Permission[] = [
  PERMISSIONS.pages.overview,
  PERMISSIONS.pages.predictions,
  PERMISSIONS.pages.plans,
  PERMISSIONS.pages.freeAccess,
  PERMISSIONS.pages.users,
  PERMISSIONS.pages.transactions,
  PERMISSIONS.pages.auditLogs,
  PERMISSIONS.pages.cms,
  PERMISSIONS.pages.security,
  PERMISSIONS.admin.createAdmins,
  PERMISSIONS.admin.grantPermissions,
];

export const NAV_PERMISSIONS: Record<string, Permission> = {
  '/admin': PERMISSIONS.pages.overview,
  '/admin/plans': PERMISSIONS.pages.plans,
  '/admin/predictions': PERMISSIONS.pages.predictions,
  '/admin/free-access': PERMISSIONS.pages.freeAccess,
  '/admin/users': PERMISSIONS.pages.users,
  '/admin/admins/create': PERMISSIONS.admin.createAdmins,
  '/admin/transactions': PERMISSIONS.pages.transactions,
  '/admin/audit-logs': PERMISSIONS.pages.auditLogs,
  '/admin/cms': PERMISSIONS.pages.cms,
  '/admin/security': PERMISSIONS.pages.security,
  '/admin/permissions': PERMISSIONS.admin.grantPermissions,
};

export const PERMISSION_LABELS: Record<Permission, string> = {
  [PERMISSIONS.pages.overview]: 'Overview',
  [PERMISSIONS.pages.predictions]: 'Predictions',
  [PERMISSIONS.pages.plans]: 'Plans',
  [PERMISSIONS.pages.freeAccess]: 'Free Access',
  [PERMISSIONS.pages.users]: 'Users',
  [PERMISSIONS.pages.transactions]: 'Transactions',
  [PERMISSIONS.pages.auditLogs]: 'Audit Logs',
  [PERMISSIONS.pages.cms]: 'CMS',
  [PERMISSIONS.pages.security]: 'Security',
  [PERMISSIONS.admin.createAdmins]: 'Create Admins',
  [PERMISSIONS.admin.grantPermissions]: 'Grant Permissions',
};

export const PERMISSION_GROUPS = [
  {
    label: 'Pages',
    permissions: [
      PERMISSIONS.pages.overview,
      PERMISSIONS.pages.predictions,
      PERMISSIONS.pages.plans,
      PERMISSIONS.pages.freeAccess,
      PERMISSIONS.pages.users,
      PERMISSIONS.pages.transactions,
      PERMISSIONS.pages.auditLogs,
      PERMISSIONS.pages.cms,
      PERMISSIONS.pages.security,
    ],
  },
  {
    label: 'Admin Powers',
    permissions: [
      PERMISSIONS.admin.createAdmins,
      PERMISSIONS.admin.grantPermissions,
    ],
  },
];
