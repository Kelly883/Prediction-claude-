'use client';

let csrfPromise: Promise<string> | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfPromise) {
    csrfPromise = fetch('/api/csrf-token', { credentials: 'same-origin' })
      .then((res) => res.json())
      .then((data) => data.csrfToken)
      .catch(() => '');
  }
  return csrfPromise;
}

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const method = (init.method || 'GET').toUpperCase();
  const isStateChanging = ['POST', 'PATCH', 'PUT', 'DELETE'].includes(method);

  let headers = new Headers(init.headers);

  if (isStateChanging) {
    const token = await getCsrfToken();
    if (token) {
      headers.set('x-csrf-token', token);
    }
  }

  const res = await fetch(input, { ...init, headers, credentials: 'same-origin' });
  if (res.status !== 401) return res;

  const refreshRes = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin' });
  if (!refreshRes.ok) {
    if (typeof window !== 'undefined') window.location.href = '/login';
    return res;
  }

  const retryHeaders = new Headers(init.headers);
  if (isStateChanging) {
    const token = await getCsrfToken();
    if (token) {
      retryHeaders.set('x-csrf-token', token);
    }
  }

  return fetch(input, { ...init, headers: retryHeaders, credentials: 'same-origin' });
}

export async function apiJson<T = any>(input: string, init: RequestInit = {}): Promise<T> {
  const res = await apiFetch(input, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`);
  return data as T;
}
