'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { apiJson } from './api-client';

type DashboardUser = { id: string; name: string; email: string; country: string; role: 'admin' | 'user' } | null;

const DashboardUserContext = createContext<{ user: DashboardUser; loading: boolean }>({ user: null, loading: true });

/**
 * Fetches /api/me exactly once per layout mount and shares it with every
 * page underneath via context, instead of each dashboard/admin page
 * independently re-fetching it just to read `.role` or `.email` — that
 * redundant fetch existed on nearly every page before this.
 */
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
