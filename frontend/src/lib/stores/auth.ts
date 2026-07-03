import { writable, get } from 'svelte/store';

export type Role = 'admin' | 'manager' | 'staff' | 'kitchen';

export interface AuthUser {
  id: number;
  name: string;
  role: Role;
}

export interface AuthState {
  token: string | null;
  user: AuthUser | null;
}

const STORAGE_KEY = 'openeats_auth';

function loadInitial(): AuthState {
  if (typeof localStorage === 'undefined') return { token: null, user: null };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    return JSON.parse(raw);
  } catch {
    return { token: null, user: null };
  }
}

export const auth = writable<AuthState>(loadInitial());

function persist(state: AuthState) {
  if (typeof localStorage === 'undefined') return;
  if (state.token && state.user) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } else {
    localStorage.removeItem(STORAGE_KEY);
  }
}

export async function login(pin: string): Promise<void> {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? 'Invalid PIN');
  }
  const { token, user } = await res.json();
  const next = { token, user };
  auth.set(next);
  persist(next);
}

export function logout(): void {
  const next = { token: null, user: null };
  auth.set(next);
  persist(next);
}

export function hasRole(role: Role | undefined, allowed: Role[]): boolean {
  return !!role && allowed.includes(role);
}

export function currentToken(): string | null {
  return get(auth).token;
}
