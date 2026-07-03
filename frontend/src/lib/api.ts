import { get } from 'svelte/store';
import { goto } from '$app/navigation';
import { auth, logout } from '$lib/stores/auth';

// Same-origin — nginx.conf proxies /api/ to the backend container.
export async function apiFetch(path: string, opts: RequestInit = {}): Promise<Response> {
  const token = get(auth).token;
  const headers = new Headers(opts.headers);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  // FormData (e.g. image uploads) must NOT get an explicit Content-Type —
  // the browser needs to set its own multipart boundary.
  if (opts.body && !(opts.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const res = await fetch(path, { ...opts, headers });

  if (res.status === 401) {
    logout();
    goto('/login');
  }

  return res;
}

export async function apiJson<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const res = await apiFetch(path, opts);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request to ${path} failed with ${res.status}`);
  }
  return res.json();
}
