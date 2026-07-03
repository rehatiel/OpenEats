import { get } from 'svelte/store';
import { settings } from '$lib/stores/settings';

const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const;
const RESET_THROTTLE_MS = 5000;

// Client-enforced idle sign-out (no server session store exists to do this
// server-side) — applies uniformly to every signed-in screen, not just
// admin, since a shared terminal left unattended is the risk regardless of
// which screen it was left on. The token's own 12h expiry is the backstop.
export function startIdleTimer(onTimeout: () => void): () => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let lastReset = 0;

  function reset() {
    const now = Date.now();
    if (now - lastReset < RESET_THROTTLE_MS) return;
    lastReset = now;
    if (timeoutId) clearTimeout(timeoutId);
    const minutes = get(settings).idle_timeout_minutes;
    timeoutId = setTimeout(onTimeout, minutes * 60 * 1000);
  }

  ACTIVITY_EVENTS.forEach((event) => window.addEventListener(event, reset));
  reset();

  return () => {
    ACTIVITY_EVENTS.forEach((event) => window.removeEventListener(event, reset));
    if (timeoutId) clearTimeout(timeoutId);
  };
}
