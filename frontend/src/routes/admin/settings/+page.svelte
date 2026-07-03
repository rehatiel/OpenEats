<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import { loadSettings } from '$lib/stores/settings';
  import { auth } from '$lib/stores/auth';
  import Button from '$lib/components/Button.svelte';

  let restaurantName = '';
  let taxRatePct = '';
  let idleTimeoutMinutes = '';
  let serviceDineIn = true;
  let serviceToGo = true;
  let serviceDelivery = true;
  let loading = true;
  let loadError = '';
  let saveError = '';
  let saved = false;
  let saving = false;

  // Demo-data danger zone
  let confirmText = '';
  let clearing = false;
  let clearError = '';
  let cleared = false;

  $: enabledServiceCount = [serviceDineIn, serviceToGo, serviceDelivery].filter(Boolean).length;
  $: serviceRows = [
    { key: 'dine_in' as const, label: 'Dine in', value: serviceDineIn },
    { key: 'to_go' as const, label: 'To go', value: serviceToGo },
    { key: 'delivery' as const, label: 'Delivery', value: serviceDelivery },
  ];

  async function load() {
    loading = true;
    try {
      const raw = await apiJson<Record<string, string>>('/api/settings');
      restaurantName = raw.restaurant_name ?? '';
      taxRatePct = raw.tax_rate ? String(Number(raw.tax_rate) * 100) : '';
      idleTimeoutMinutes = raw.idle_timeout_minutes ?? '';
      serviceDineIn = raw.service_dine_in !== '0';
      serviceToGo = raw.service_to_go !== '0';
      serviceDelivery = raw.service_delivery !== '0';
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load settings';
    } finally {
      loading = false;
    }
  }

  // A business must always support at least one order type — refuse to turn
  // off the last one still on rather than letting the server reject it.
  function toggleService(which: 'dine_in' | 'to_go' | 'delivery', value: boolean) {
    if (!value && enabledServiceCount <= 1) return;
    if (which === 'dine_in') serviceDineIn = value;
    if (which === 'to_go') serviceToGo = value;
    if (which === 'delivery') serviceDelivery = value;
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
          service_dine_in: serviceDineIn ? '1' : '0',
          service_to_go: serviceToGo ? '1' : '0',
          service_delivery: serviceDelivery ? '1' : '0',
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

  async function clearDemoData() {
    if (confirmText.trim() !== restaurantName.trim()) return;
    clearing = true;
    clearError = '';
    try {
      await apiJson('/api/admin/demo-data', { method: 'DELETE' });
      cleared = true;
      confirmText = '';
    } catch (e) {
      clearError = e instanceof Error ? e.message : 'Failed to clear demo data';
    } finally {
      clearing = false;
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

      <div class="mb-1 block text-xs font-bold uppercase tracking-wide text-counter-muted">Service types</div>
      <div class="mb-6 space-y-2">
        {#each serviceRows as row (row.key)}
          <div class="flex items-center justify-between rounded-lg border border-counter-line bg-counter-paper px-3 py-2">
            <span class="text-[15px] font-semibold text-counter-ink">{row.label}</span>
            <div class="flex gap-2">
              <button
                class="h-9 rounded-lg px-3 text-sm font-bold {row.value ? 'bg-counter-ink text-white' : 'bg-white text-counter-muted-2'}"
                on:click={() => toggleService(row.key, true)}
              >
                On
              </button>
              <button
                class="h-9 rounded-lg px-3 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-40 {!row.value
                  ? 'bg-counter-ink text-white'
                  : 'bg-white text-counter-muted-2'}"
                disabled={row.value && enabledServiceCount <= 1}
                on:click={() => toggleService(row.key, false)}
              >
                Off
              </button>
            </div>
          </div>
        {/each}
      </div>
      <div class="mb-6 text-xs text-counter-muted">A food truck with no seating, for example, can turn Dine in off — Order Entry and navigation adjust to match. At least one type must stay on.</div>

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

    <div class="mt-6 rounded-2xl border border-[#F5C2A6] bg-[#FEF0E9] p-6">
      <div class="mb-1 text-[15px] font-extrabold text-[#C2410C]">Danger zone</div>
      <p class="mb-4 text-sm text-[#9A3412]">
        Clear demo data removes every current menu item and table (the same reversible "Remove" each already
        supports, just applied to all of them at once). Since there's no way to tell seeded items apart from ones
        you've since added, this clears your <em>entire</em> current menu and floor plan — not just the original
        taco-shop demo — so only run it once, before taking real orders. Order history and past receipts are not
        affected.
      </p>
      {#if cleared}
        <div class="mb-3 text-sm font-semibold text-[#9A3412]">
          Done — the menu and floor plan are cleared. Add your own in Admin → Menu and Admin → Tables.
        </div>
      {:else}
        <label for="settings-confirm" class="mb-1 block text-xs font-bold uppercase tracking-wide text-[#9A3412]">
          Type "{restaurantName}" to confirm
        </label>
        <input
          id="settings-confirm"
          class="mb-3 h-11 w-full rounded-lg border border-[#F5C2A6] bg-white px-3 text-[15px] text-counter-ink"
          bind:value={confirmText}
        />
        {#if clearError}
          <div class="mb-3 text-sm font-semibold text-[#C2410C]">{clearError}</div>
        {/if}
        <button
          class="h-11 w-full rounded-lg bg-[#C2410C] text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-40"
          disabled={clearing || confirmText.trim() !== restaurantName.trim()}
          on:click={clearDemoData}
        >
          {clearing ? 'Clearing…' : 'Clear demo data'}
        </button>
      {/if}
    </div>
  {/if}
</div>
