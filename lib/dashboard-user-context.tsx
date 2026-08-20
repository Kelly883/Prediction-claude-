'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiJson } from './api-client';
import type { Permission } from './permissions';

type DashboardUser = { id: string; name: string; email: string; country: string; role: 'admin' | 'user' | 'superadmin'; permissions: Permission[] } | null;

const DashboardUserContext = createContext<{ user: DashboardUser; loading: boolean }>({ user: null, loading: true });

export function DashboardUserProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<DashboardUser>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiJson<DashboardUser>('/api/me')
      .then(setUser)
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  return <DashboardUserContext.Provider value={{ user, loading }}>{children}</DashboardUserContext.Provider>;
}

export function useDashboardUser() {
  return useContext(DashboardUserContext);
}
