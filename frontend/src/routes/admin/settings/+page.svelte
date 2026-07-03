<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import { loadSettings } from '$lib/stores/settings';
  import { auth } from '$lib/stores/auth';
  import Button from '$lib/components/Button.svelte';

  let restaurantName = '';
  let taxRatePct = '';
  let idleTimeoutMinutes = '';
  let loading = true;
  let loadError = '';
  let saveError = '';
  let saved = false;
  let saving = false;

  async function load() {
    loading = true;
    try {
      const raw = await apiJson<Record<string, string>>('/api/settings');
      restaurantName = raw.restaurant_name ?? '';
      taxRatePct = raw.tax_rate ? String(Number(raw.tax_rate) * 100) : '';
      idleTimeoutMinutes = raw.idle_timeout_minutes ?? '';
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  async function save() {
    saveError = '';
    saved = false;

    const taxRate = Number(taxRatePct) / 100;
    const idleMinutes = Number(idleTimeoutMinutes);
    if (!restaurantName.trim()) {
      saveError = 'Restaurant name is required';
      return;
    }
    if (!Number.isFinite(taxRate) || taxRate < 0 || taxRate > 100) {
      saveError = 'Tax rate must be a valid percentage';
      return;
    }
    if (!Number.isInteger(idleMinutes) || idleMinutes <= 0) {
      saveError = 'Idle timeout must be a positive whole number of minutes';
      return;
    }

    saving = true;
    try {
      await apiJson('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          restaurant_name: restaurantName.trim(),
          tax_rate: taxRate,
          idle_timeout_minutes: idleMinutes,
        }),
      });
      saved = true;
      const token = $auth.token;
      if (token) await loadSettings(token);
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save settings';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Settings · Admin · OpenEats</title>
</svelte:head>

<div class="max-w-[520px] p-6">
  <div class="mb-5 text-xl font-extrabold text-counter-ink">Platform settings</div>

  {#if loading}
    <div class="text-sm text-counter-muted">Loading…</div>
  {:else}
    <div class="rounded-2xl border border-counter-line bg-white p-6">
      <label for="settings-name" class="mb-1 block text-xs font-bold uppercase tracking-wide text-counter-muted">Restaurant name</label>
      <input
        id="settings-name"
        class="mb-5 h-11 w-full rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={restaurantName}
      />

      <label for="settings-tax" class="mb-1 block text-xs font-bold uppercase tracking-wide text-counter-muted">Sales tax rate (%)</label>
      <input
        id="settings-tax"
        type="number"
        step="0.01"
        min="0"
        max="100"
        class="mb-5 h-11 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={taxRatePct}
      />

      <label for="settings-idle" class="mb-1 block text-xs font-bold uppercase tracking-wide text-counter-muted">
        Auto sign-out after inactivity (minutes)
      </label>
      <input
        id="settings-idle"
        type="number"
        step="1"
        min="1"
        class="mb-6 h-11 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={idleTimeoutMinutes}
      />

      {#if loadError}
        <div class="mb-4 text-sm font-semibold text-counter-orange-dark">{loadError}</div>
      {/if}
      {#if saveError}
        <div class="mb-4 text-sm font-semibold text-counter-orange-dark">{saveError}</div>
      {/if}
      {#if saved}
        <div class="mb-4 text-sm font-semibold text-counter-paid">Saved.</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save settings'}
      </Button>
    </div>
  {/if}
</div>
