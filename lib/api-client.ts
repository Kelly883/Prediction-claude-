'use client';

/**
 * Thin fetch wrapper for client components: on a 401, tries /api/auth/refresh
 * once and retries the original request before giving up. Without this, the
 * refresh endpoint existing doesn't actually help anyone — something has to
 * call it. If refresh also fails, redirects to /login.
 */
export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(input, { ...init, credentials: 'same-origin' });
  if (res.status !== 401) return res;

  const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  if (!refreshRes.ok) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return res;
  }

  return fetch(input, { ...init, credentials: 'same-origin' });
}

export async function apiJson<T = any>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}
