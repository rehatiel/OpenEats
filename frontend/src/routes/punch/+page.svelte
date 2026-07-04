<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { apiJson } from '$lib/api';
  import Keypad from '$lib/components/Keypad.svelte';
  import TopBarNav from '$lib/components/TopBarNav.svelte';

  const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  const navLinks = [{ href: '/', label: 'Order' }];

  interface OnShiftEntry {
    id: number;
    user_id: number;
    name: string;
    clock_in: string;
  }

  let pin = '';
  let submitting = false;
  let error = '';
  let confirmation = '';
  let onShift: OnShiftEntry[] = [];
  let timer: ReturnType<typeof setInterval>;

  async function loadOnShift() {
    try {
      onShift = await apiJson<OnShiftEntry[]>('/api/time-clock/on-shift');
    } catch {
      // Keep the last-known list rather than blanking it on a transient poll failure.
    }
  }

  onMount(() => {
    loadOnShift();
    timer = setInterval(loadOnShift, 5000);
  });
  onDestroy(() => clearInterval(timer));

  function minutesAgo(iso: string) {
    return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  }

  async function punch(action: 'clock-in' | 'clock-out') {
    if (submitting || pin.length < 4) return;
    submitting = true;
    error = '';
    confirmation = '';
    try {
      const result = await apiJson<{ user_name: string; clock_in: string; clock_out: string | null }>(
        `/api/time-clock/${action}`,
        { method: 'POST', body: JSON.stringify({ pin }) }
      );
      if (action === 'clock-in') {
        confirmation = `${result.user_name} clocked in at ${new Date(result.clock_in).toLocaleTimeString()}`;
      } else {
        const hours = (new Date(result.clock_out ?? '').getTime() - new Date(result.clock_in).getTime()) / 3600000;
        confirmation = `${result.user_name} clocked out — worked ${hours.toFixed(1)}h`;
      }
      pin = '';
      loadOnShift();
      setTimeout(() => (confirmation = ''), 3500);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to record punch';
      pin = '';
    } finally {
      submitting = false;
    }
  }

  function pressKey(k: string) {
    if (submitting) return;
    error = '';
    if (k === '⌫') {
      pin = pin.slice(0, -1);
      return;
    }
    if (pin.length >= 6) return;
    pin = pin + k;
  }
</script>

<svelte:head>
  <title>Time Clock · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
  <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
    <div class="text-lg font-extrabold text-counter-ink">Time Clock</div>
    <div class="flex-1"></div>
    <TopBarNav links={navLinks} />
  </div>

  <div class="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto p-6 lg:flex-row lg:items-stretch">
    <div class="w-full max-w-[360px] rounded-2xl border border-counter-line bg-white p-8">
      <div class="mb-5 text-center font-mono text-xs text-counter-muted">Enter your PIN, then Clock In or Clock Out</div>

      <div class="mb-5 flex justify-center gap-3">
        {#each Array(6) as _, i}
          <div
            class="h-3.5 w-3.5 rounded-full border-2 {i < pin.length
              ? 'border-counter-orange bg-counter-orange'
              : 'border-counter-line bg-transparent'}"
          ></div>
        {/each}
      </div>

      {#if error}
        <div class="mb-3 text-center text-sm font-semibold text-counter-orange-dark">{error}</div>
      {/if}
      {#if confirmation}
        <div class="mb-3 text-center text-sm font-semibold text-counter-paid">{confirmation}</div>
      {/if}

      <Keypad keys={PIN_KEYS} on:press={(e) => pressKey(e.detail)} />

      <div class="mt-5 grid grid-cols-2 gap-3">
        <button
          class="h-14 rounded-xl bg-counter-paid text-sm font-extrabold text-white disabled:opacity-40"
          disabled={submitting || pin.length < 4}
          on:click={() => punch('clock-in')}
        >
          Clock In →
        </button>
        <button
          class="h-14 rounded-xl bg-counter-ink text-sm font-extrabold text-white disabled:opacity-40"
          disabled={submitting || pin.length < 4}
          on:click={() => punch('clock-out')}
        >
          Clock Out →
        </button>
      </div>
    </div>

    <div class="w-full max-w-[360px] rounded-2xl border border-counter-line bg-white p-6">
      <div class="mb-3 text-sm font-extrabold text-counter-ink">On shift now</div>
      {#if onShift.length === 0}
        <div class="py-6 text-center text-sm text-counter-muted">Nobody's clocked in right now.</div>
      {:else}
        <div class="space-y-2">
          {#each onShift as entry (entry.id)}
            <div class="flex items-center justify-between rounded-lg bg-counter-paper px-3 py-2.5">
              <span class="text-sm font-semibold text-counter-ink">{entry.name}</span>
              <span class="font-mono text-xs text-counter-muted">{minutesAgo(entry.clock_in)} min</span>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
