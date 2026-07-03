<script lang="ts">
  // Self-hosted variable fonts — no CDN calls, so the app stays fully usable
  // offline (a food truck box may have no internet at point of sale).
  import '@fontsource-variable/archivo';
  import '@fontsource-variable/jetbrains-mono';
  import '../app.css';

  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { onDestroy } from 'svelte';
  import { auth, logout, hasRole } from '$lib/stores/auth';
  import type { Role } from '$lib/stores/auth';
  import { loadSettings } from '$lib/stores/settings';
  import { startIdleTimer } from '$lib/idleTimer';

  // Kitchen sessions are a shared, always-on display — they only ever get
  // the KDS screen, never the rest of the POS.
  function homeFor(role: Role | undefined): string {
    return role === 'kitchen' ? '/kitchen' : '/';
  }

  function routeAllowed(pathname: string, role: Role | undefined): boolean {
    if (role === 'kitchen') return pathname === '/kitchen';
    if (pathname.startsWith('/admin')) return hasRole(role, ['admin']);
    if (pathname === '/dashboard') return hasRole(role, ['admin', 'manager']);
    return hasRole(role, ['admin', 'manager', 'staff']);
  }

  let allowed = false;

  // Computed synchronously (localStorage hydration is sync) before <slot/>
  // ever renders, so a hard refresh/deep link to a gated route never flashes
  // its content before redirecting — there's no server to do this guard for
  // us ahead of the client bundle mounting.
  $: {
    const pathname = $page.url.pathname;
    const user = $auth.user;

    if (pathname === '/login') {
      allowed = !user;
      if (user) goto(homeFor(user.role));
    } else if (!user) {
      allowed = false;
      goto('/login');
    } else if (!routeAllowed(pathname, user.role)) {
      allowed = false;
      goto(homeFor(user.role));
    } else {
      allowed = true;
    }
  }

  // The idle timer's first arm must use the real idle_timeout_minutes, not
  // the settings store's fallback default — so it only starts once the
  // settings fetch for this session has resolved, not synchronously at
  // login. Otherwise a shorter admin-configured timeout wouldn't take
  // effect until some unrelated activity happened to re-arm it later.
  let settingsRequestedFor: string | null = null;
  let stopIdleTimer: (() => void) | null = null;

  $: if ($auth.token && settingsRequestedFor !== $auth.token) {
    settingsRequestedFor = $auth.token;
    loadSettings($auth.token).finally(() => {
      // Kitchen displays must stay signed in indefinitely — no idle timer.
      if ($auth.user && $auth.user.role !== 'kitchen' && !stopIdleTimer) {
        stopIdleTimer = startIdleTimer(() => {
          logout();
          goto('/login');
        });
      }
    });
  }

  $: if (!$auth.user) {
    settingsRequestedFor = null;
    if (stopIdleTimer) {
      stopIdleTimer();
      stopIdleTimer = null;
    }
  }

  onDestroy(() => {
    if (stopIdleTimer) stopIdleTimer();
  });
</script>

{#if allowed}
  <slot />
{/if}
