<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface VendorRow {
    id: number;
    name: string;
  }
  interface IngredientRow {
    id: number;
    name: string;
    unit: string;
    unit_cost: number;
  }
  interface POItem {
    id: number;
    ingredient_id: number;
    name: string;
    unit: string;
    quantity: number;
    unit_price_paid: number;
  }
  interface PORow {
    id: number;
    vendor_id: number;
    vendor_name: string;
    order_number: string | null;
    tracking_number: string | null;
    status: 'ordered' | 'received' | 'cancelled';
    created_at: string;
    received_at: string | null;
    items: POItem[];
    total: number;
  }
  interface DraftLine {
    ingredient_id: number | null;
    quantity: string;
    unit_price_paid: string;
  }

  let purchaseOrders: PORow[] = [];
  let vendors: VendorRow[] = [];
  let ingredients: IngredientRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let formVendorId: number | null = null;
  let formOrderNumber = '';
  let formTrackingNumber = '';
  let formNotes = '';
  let draftLines: DraftLine[] = [];
  let formError = '';
  let saving = false;

  let receivingId: number | null = null;

  async function load() {
    loading = true;
    try {
      [purchaseOrders, vendors, ingredients] = await Promise.all([
        apiJson<PORow[]>('/api/purchase-orders'),
        apiJson<VendorRow[]>('/api/vendors'),
        apiJson<IngredientRow[]>('/api/ingredients'),
      ]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load purchase orders';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    await load();
    if ($page.url.searchParams.get('restock') === '1') {
      await openFromRestockList();
    }
  });

  function openBlank() {
    formVendorId = vendors[0]?.id ?? null;
    formOrderNumber = '';
    formTrackingNumber = '';
    formNotes = '';
    draftLines = [{ ingredient_id: ingredients[0]?.id ?? null, quantity: '1', unit_price_paid: '0' }];
    formError = '';
    formOpen = true;
  }

  async function openFromRestockList() {
    try {
      const restock = await apiJson<(IngredientRow & { reorder_quantity: number })[]>('/api/ingredients/restock-list');
      if (restock.length === 0) return;
      formVendorId = vendors[0]?.id ?? null;
      formOrderNumber = '';
      formTrackingNumber = '';
      formNotes = '';
      draftLines = restock.map((i) => ({
        ingredient_id: i.id,
        quantity: String(i.reorder_quantity || 1),
        unit_price_paid: String(i.unit_cost || 0),
      }));
      formError = '';
      formOpen = true;
    } catch {
      // Fall back to a blank order if the restock list can't be fetched.
    }
  }

  function addLine() {
    draftLines = [...draftLines, { ingredient_id: ingredients[0]?.id ?? null, quantity: '1', unit_price_paid: '0' }];
  }

  function removeLine(index: number) {
    draftLines = draftLines.filter((_, i) => i !== index);
  }

  function ingredientName(id: number | null) {
    return ingredients.find((i) => i.id === id)?.name ?? '';
  }

  async function save() {
    formError = '';
    if (!formVendorId) {
      formError = 'Choose a vendor';
      return;
    }
    if (draftLines.length === 0) {
      formError = 'Add at least one item';
      return;
    }
    const items = [];
    for (const line of draftLines) {
      const quantity = Number(line.quantity);
      const price = Number(line.unit_price_paid);
      if (!line.ingredient_id) {
        formError = 'Every line needs an ingredient';
        return;
      }
      if (!Number.isFinite(quantity) || quantity <= 0) {
        formError = `Quantity for ${ingredientName(line.ingredient_id)} must be a positive number`;
        return;
      }
      if (!Number.isFinite(price) || price < 0) {
        formError = `Price paid for ${ingredientName(line.ingredient_id)} must be a non-negative number`;
        return;
      }
      items.push({ ingredient_id: line.ingredient_id, quantity, unit_price_paid: price });
    }

    saving = true;
    try {
      await apiJson('/api/purchase-orders', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: formVendorId,
          order_number: formOrderNumber.trim() || undefined,
          tracking_number: formTrackingNumber.trim() || undefined,
          notes: formNotes.trim() || undefined,
          items,
        }),
      });
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Failed to create purchase order';
    } finally {
      saving = false;
    }
  }

  async function markReceived(po: PORow) {
    receivingId = po.id;
    loadError = '';
    try {
      await apiJson(`/api/purchase-orders/${po.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'received' }) });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to mark received';
    } finally {
      receivingId = null;
    }
  }

  const statusLabel: Record<PORow['status'], string> = { ordered: 'Ordered', received: 'Received', cancelled: 'Cancelled' };
  const statusColor: Record<PORow['status'], string> = {
    ordered: 'bg-[#FFF7E6] text-[#A16207]',
    received: 'bg-[#E7F7EE] text-counter-paid',
    cancelled: 'bg-counter-paper text-counter-muted-2',
  };
</script>

<svelte:head>
  <title>Purchase Orders · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Purchase orders</div>
      <Button variant="primary" on:click={openBlank} disabled={vendors.length === 0}>+ New order</Button>
    </div>

    {#if vendors.length === 0 && !loading}
      <div class="mb-4 rounded-lg bg-counter-paper px-4 py-2.5 text-sm text-counter-muted">
        Add a vendor first in Admin → Vendors before creating a purchase order.
      </div>
    {/if}
    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper bg-counter-cream px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Vendor</div>
          <div>Order #</div>
          <div>Status</div>
          <div>Total</div>
          <div>Ordered</div>
          <div></div>
        </div>
        {#each purchaseOrders as po (po.id)}
          <div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{po.vendor_name}</div>
            <div class="font-mono text-sm text-counter-muted-2">{po.order_number ?? '—'}</div>
            <div><span class="rounded-full px-2.5 py-0.5 text-xs font-bold {statusColor[po.status]}">{statusLabel[po.status]}</span></div>
            <div class="font-mono text-counter-muted-2">${po.total.toFixed(2)}</div>
            <div class="font-mono text-xs text-counter-muted">{new Date(po.created_at).toLocaleDateString()}</div>
            <div class="flex justify-end">
              {#if po.status === 'ordered'}
                <button
                  class="rounded-lg bg-counter-ink px-3 py-1.5 text-xs font-bold text-white disabled:opacity-50"
                  disabled={receivingId === po.id}
                  on:click={() => markReceived(po)}
                >
                  {receivingId === po.id ? 'Receiving…' : 'Mark received'}
                </button>
              {/if}
            </div>
          </div>
        {/each}
        {#if purchaseOrders.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No purchase orders yet.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[420px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">New purchase order</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="po-vendor" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Vendor</label>
      <select
        id="po-vendor"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formVendorId}
      >
        {#each vendors as v (v.id)}
          <option value={v.id}>{v.name}</option>
        {/each}
      </select>

      <label for="po-order-number" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Order #</label>
      <input
        id="po-order-number"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formOrderNumber}
      />

      <label for="po-tracking" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Tracking #</label>
      <input
        id="po-tracking"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formTrackingNumber}
      />

      <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Items</div>
      {#each draftLines as line, i}
        <div class="mb-2 flex items-end gap-2">
          <div class="min-w-0 flex-1">
            <select
              class="h-10 w-full rounded-lg border border-counter-line bg-counter-paper px-2 text-sm text-counter-ink"
              bind:value={line.ingredient_id}
            >
              {#each ingredients as ing (ing.id)}
                <option value={ing.id}>{ing.name}</option>
              {/each}
            </select>
          </div>
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="Qty"
            class="h-10 w-20 rounded-lg border border-counter-line bg-counter-paper px-2 font-mono text-sm text-counter-ink"
            bind:value={line.quantity}
          />
          <input
            type="number"
            step="0.01"
            min="0"
            placeholder="$ paid"
            class="h-10 w-24 rounded-lg border border-counter-line bg-counter-paper px-2 font-mono text-sm text-counter-ink"
            bind:value={line.unit_price_paid}
          />
          <button class="h-10 flex-none px-2 text-sm font-bold text-counter-muted-2 hover:text-counter-orange-dark" on:click={() => removeLine(i)}>
            ✕
          </button>
        </div>
      {/each}
      <button class="mb-4 h-10 rounded-lg bg-counter-paper text-sm font-bold text-counter-ink" on:click={addLine} disabled={ingredients.length === 0}>
        + Add line
      </button>

      <label for="po-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
      <textarea
        id="po-notes"
        class="mb-4 min-h-[60px] rounded-lg border border-counter-line bg-counter-paper px-3 py-2 text-[15px] text-counter-ink"
        bind:value={formNotes}
      ></textarea>

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Placing…' : 'Place order'}
      </Button>
    </div>
  {/if}
</div>
