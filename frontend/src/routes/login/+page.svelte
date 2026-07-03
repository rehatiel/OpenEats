<script lang="ts">
  import { goto } from '$app/navigation';
  import { login } from '$lib/stores/auth';
  import Keypad from '$lib/components/Keypad.svelte';

  const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];

  let pin = '';
  let error = '';
  let shake = false;
  let submitting = false;

  async function tryLogin(candidate: string) {
    submitting = true;
    try {
      await login(candidate);
      goto('/');
    } catch (e) {
      error = e instanceof Error ? e.message : 'Invalid PIN';
      shake = true;
      pin = '';
      setTimeout(() => (shake = false), 400);
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
    if (pin.length === 4) {
      // Auto-submit at the common 4-digit length; longer PINs keep typing
      // until the user stops (debounced) or hits the 6-digit cap.
      const captured = pin;
      setTimeout(() => {
        if (pin === captured) tryLogin(pin);
      }, 350);
    } else if (pin.length === 6) {
      tryLogin(pin);
    }
  }
</script>

<svelte:head>
  <title>Sign in · OpenEats</title>
</svelte:head>

<div class="flex h-screen items-center justify-center bg-counter-paper px-4">
  <div class="w-full max-w-[360px] rounded-2xl border border-counter-line bg-white p-8 shadow-sm {shake ? 'animate-[shake_0.4s]' : ''}">
    <div class="mb-6 flex flex-col items-center">
      <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-counter-orange text-xl font-black text-white">
        O
      </div>
      <div class="mt-3 text-lg font-extrabold text-counter-ink">El Camión</div>
      <div class="font-mono text-xs text-counter-muted">Enter your PIN to sign in</div>
    </div>

    <div class="mb-6 flex justify-center gap-3">
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

    <Keypad keys={PIN_KEYS} on:press={(e) => pressKey(e.detail)} />
  </div>
</div>

<style>
  @keyframes shake {
    0%, 100% { transform: translateX(0); }
    20%, 60% { transform: translateX(-8px); }
    40%, 80% { transform: translateX(8px); }
  }
</style>
