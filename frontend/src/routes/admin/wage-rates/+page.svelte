<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface UserRow {
    id: number;
    name: string;
    active: number;
  }

  interface WageRateRow {
    id: number;
    user_id: number;
    user_name: string;
    hourly_rate: number;
    effective_date: string;
  }

  let rates: WageRateRow[] = [];
  let users: UserRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let formUserId: number | null = null;
  let formHourlyRate = '';
  let formEffectiveDate = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      [rates, users] = await Promise.all([
        apiJson<WageRateRow[]>('/api/time-clock/wage-rates'),
        apiJson<UserRow[]>('/api/admin/users'),
      ]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load wage rates';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    formUserId = users.find((u) => u.active)?.id ?? null;
    formHourlyRate = '';
    formEffectiveDate = new Date().toISOString().slice(0, 10);
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const hourlyRate = Number(formHourlyRate);
    if (!formUserId) {
      formError = 'Select an employee';
      return;
    }
    if (!Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      formError = 'Hourly rate must be a positive number';
      return;
    }
    if (!formEffectiveDate) {
      formError = 'Effective date is required';
      return;
    }
    saving = true;
    try {
      await apiJson('/api/time-clock/wage-rates', {
        method: 'POST',
        body: JSON.stringify({ user_id: formUserId, hourly_rate: hourlyRate, effective_date: formEffectiveDate }),
      });
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Wage Rates · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-2 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Wage rates</div>
      <Button variant="primary" on:click={openAdd}>+ Add rate</Button>
    </div>
    <div class="mb-5 text-sm text-counter-muted">
      A new rate takes effect from its date forward — it never rewrites the cost of hours already worked, even for a past
      effective date entered late.
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[2fr_1fr_1fr] gap-2 border-b border-counter-paper px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Employee</div>
          <div>Rate</div>
          <div>Effective</div>
        </div>
        {#each rates as rate (rate.id)}
          <div class="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{rate.user_name}</div>
            <div class="font-mono text-counter-muted-2">${rate.hourly_rate.toFixed(2)}/hr</div>
            <div class="font-mono text-sm text-counter-muted-2">{rate.effective_date}</div>
          </div>
        {/each}
        {#if rates.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No wage rates on file yet.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Add rate</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="wage-user" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Employee</label>
      <select
        id="wage-user"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formUserId}
      >
        {#each users.filter((u) => u.active) as u (u.id)}
          <option value={u.id}>{u.name}</option>
        {/each}
      </select>

      <label for="wage-rate" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Hourly rate ($)</label>
      <input
        id="wage-rate"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formHourlyRate}
      />

      <label for="wage-date" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Effective date</label>
      <input
        id="wage-date"
        type="date"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formEffectiveDate}
      />

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
