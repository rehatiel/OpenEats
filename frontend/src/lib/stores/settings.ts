import { writable } from 'svelte/store';

export interface PlatformSettings {
  tax_rate: number;
  restaurant_name: string;
  idle_timeout_minutes: number;
}

// Fallbacks used only until the real settings load (or if the fetch fails) —
// mirrors the previous hardcoded defaults so nothing looks broken mid-fetch.
const DEFAULTS: PlatformSettings = {
  tax_rate: 0.0825,
  restaurant_name: 'El Camión',
  idle_timeout_minutes: 15,
};

export const settings = writable<PlatformSettings>(DEFAULTS);

export async function loadSettings(token: string): Promise<void> {
  try {
    const res = await fetch('/api/settings', {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return;
    const raw: Record<string, string> = await res.json();
    settings.set({
      tax_rate: raw.tax_rate !== undefined ? Number(raw.tax_rate) : DEFAULTS.tax_rate,
      restaurant_name: raw.restaurant_name ?? DEFAULTS.restaurant_name,
      idle_timeout_minutes:
        raw.idle_timeout_minutes !== undefined ? Number(raw.idle_timeout_minutes) : DEFAULTS.idle_timeout_minutes,
    });
  } catch {
    // Keep defaults — a failed settings fetch shouldn't block the app.
  }
}
