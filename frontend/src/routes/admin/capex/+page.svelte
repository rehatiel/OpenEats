<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface VendorRow {
    id: number;
    name: string;
  }

  interface CapexRow {
    id: number;
    description: string;
    category: string | null;
    purchase_date: string;
    amount: number;
    vendor_id: number | null;
    vendor_name: string | null;
    useful_life_months: number | null;
    notes: string | null;
  }

  let items: CapexRow[] = [];
  let vendors: VendorRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let formDescription = '';
  let formCategory = '';
  let formPurchaseDate = '';
  let formAmount = '';
  let formVendorId: number | null = null;
  let formUsefulLife = '';
  let formNotes = '';
  let formError = '';
  let saving = false;

  $: totalAmount = items.reduce((sum, i) => sum + i.amount, 0);

  async function load() {
    loading = true;
    try {
      [items, vendors] = await Promise.all([apiJson<CapexRow[]>('/api/capex'), apiJson<VendorRow[]>('/api/vendors')]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load CapEx log';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    formDescription = '';
    formCategory = '';
    formPurchaseDate = new Date().toISOString().slice(0, 10);
    formAmount = '';
    formVendorId = null;
    formUsefulLife = '';
    formNotes = '';
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const amount = Number(formAmount);
    if (!formDescription.trim()) {
      formError = 'Description is required';
      return;
    }
    if (!formPurchaseDate) {
      formError = 'Purchase date is required';
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      formError = 'Amount must be a positive number';
      return;
    }
    saving = true;
    try {
      await apiJson('/api/capex', {
        method: 'POST',
        body: JSON.stringify({
          description: formDescription.trim(),
          category: formCategory.trim() || null,
          purchase_date: formPurchaseDate,
          amount,
          vendor_id: formVendorId,
          useful_life_months: formUsefulLife.trim() ? Number(formUsefulLife) : null,
          notes: formNotes.trim() || null,
        }),
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
  <title>CapEx Log · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">CapEx log</div>
      <Button variant="primary" on:click={openAdd}>+ Add asset</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="mb-4 text-sm font-semibold text-counter-muted-2">Total: <span class="font-mono text-counter-ink">${totalAmount.toFixed(2)}</span></div>
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Description</div>
          <div>Category</div>
          <div>Purchased</div>
          <div>Amount</div>
          <div>Vendor</div>
        </div>
        {#each items as item (item.id)}
          <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{item.description}</div>
            <div class="text-counter-muted-2">{item.category ?? '—'}</div>
            <div class="font-mono text-sm text-counter-muted-2">{item.purchase_date}</div>
            <div class="font-mono text-counter-muted-2">${item.amount.toFixed(2)}</div>
            <div class="text-counter-muted-2">{item.vendor_name ?? '—'}</div>
          </div>
        {/each}
        {#if items.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No capital purchases logged yet.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Add asset</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="capex-desc" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Description</label>
      <input
        id="capex-desc"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formDescription}
        placeholder="e.g. Commercial fryer"
      />

      <label for="capex-category" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Category</label>
      <input
        id="capex-category"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formCategory}
        placeholder="e.g. Kitchen equipment"
      />

      <label for="capex-date" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Purchase date</label>
      <input
        id="capex-date"
        type="date"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formPurchaseDate}
      />

      <label for="capex-amount" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Amount ($)</label>
      <input
        id="capex-amount"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formAmount}
      />

      <label for="capex-vendor" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Vendor (optional)</label>
      <select
        id="capex-vendor"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formVendorId}
      >
        <option value={null}>—</option>
        {#each vendors as v (v.id)}
          <option value={v.id}>{v.name}</option>
        {/each}
      </select>

      <label for="capex-life" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Useful life (months, optional)</label>
      <input
        id="capex-life"
        type="number"
        step="1"
        min="1"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formUsefulLife}
      />

      <label for="capex-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
      <textarea
        id="capex-notes"
        class="mb-4 min-h-[80px] rounded-lg border border-counter-line bg-counter-paper px-3 py-2 text-[15px] text-counter-ink"
        bind:value={formNotes}
      ></textarea>

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
