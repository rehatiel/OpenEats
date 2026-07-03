<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface IngredientRow {
    id: number;
    name: string;
    unit: string;
    current_stock: number;
    unit_cost: number;
    reorder_threshold: number;
    reorder_quantity: number;
    active: number;
  }

  let ingredients: IngredientRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let editing: IngredientRow | null = null;
  let formName = '';
  let formUnit = '';
  let formStock = '';
  let formCost = '';
  let formThreshold = '';
  let formQuantity = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      ingredients = await apiJson<IngredientRow[]>('/api/ingredients');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load ingredients';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    editing = null;
    formName = '';
    formUnit = '';
    formStock = '0';
    formCost = '0';
    formThreshold = '0';
    formQuantity = '0';
    formError = '';
    formOpen = true;
  }

  function openEdit(item: IngredientRow) {
    editing = item;
    formName = item.name;
    formUnit = item.unit;
    formStock = String(item.current_stock);
    formCost = String(item.unit_cost);
    formThreshold = String(item.reorder_threshold);
    formQuantity = String(item.reorder_quantity);
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const stock = Number(formStock);
    const cost = Number(formCost);
    const threshold = Number(formThreshold);
    const quantity = Number(formQuantity);
    if (!formName.trim()) {
      formError = 'Name is required';
      return;
    }
    if (!formUnit.trim()) {
      formError = 'Unit is required (e.g. kg, case, bottle)';
      return;
    }
    for (const [value, label] of [
      [stock, 'Current stock'],
      [cost, 'Unit cost'],
      [threshold, 'Reorder threshold'],
      [quantity, 'Reorder quantity'],
    ] as const) {
      if (!Number.isFinite(value) || value < 0) {
        formError = `${label} must be a non-negative number`;
        return;
      }
    }

    saving = true;
    try {
      const body = {
        name: formName.trim(),
        unit: formUnit.trim(),
        current_stock: stock,
        unit_cost: cost,
        reorder_threshold: threshold,
        reorder_quantity: quantity,
      };
      if (editing) {
        await apiJson(`/api/ingredients/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiJson('/api/ingredients', { method: 'POST', body: JSON.stringify(body) });
      }
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function removeIngredient(item: IngredientRow) {
    loadError = '';
    try {
      await apiJson(`/api/ingredients/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Delete failed';
    }
  }
</script>

<svelte:head>
  <title>Inventory · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Ingredients</div>
      <Button variant="primary" on:click={openAdd}>+ Add ingredient</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper bg-counter-cream px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Name</div>
          <div>Stock</div>
          <div>Unit cost</div>
          <div>Reorder at</div>
          <div>Reorder qty</div>
          <div></div>
        </div>
        {#each ingredients as item (item.id)}
          <div
            class="grid grid-cols-[2fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0 {item.current_stock <=
            item.reorder_threshold
              ? 'bg-[#FEF0E9]'
              : ''}"
          >
            <div class="font-semibold text-counter-ink">{item.name}</div>
            <div class="font-mono text-counter-muted-2">{item.current_stock} {item.unit}</div>
            <div class="font-mono text-counter-muted-2">${item.unit_cost.toFixed(2)}</div>
            <div class="font-mono text-counter-muted-2">{item.reorder_threshold} {item.unit}</div>
            <div class="font-mono text-counter-muted-2">{item.reorder_quantity} {item.unit}</div>
            <div class="flex justify-end gap-2 text-sm font-bold">
              <button class="text-counter-muted-2 hover:text-counter-ink" on:click={() => openEdit(item)}>Edit</button>
              <button class="text-counter-muted-2 hover:text-counter-orange-dark" on:click={() => removeIngredient(item)}>Remove</button>
            </div>
          </div>
        {/each}
        {#if ingredients.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No ingredients yet — add the first one.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">{editing ? 'Edit ingredient' : 'Add ingredient'}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="ing-name" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Name</label>
      <input
        id="ing-name"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formName}
        placeholder="e.g. Corn tortillas"
      />

      <label for="ing-unit" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Unit</label>
      <input
        id="ing-unit"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formUnit}
        placeholder="e.g. kg, case, bottle"
      />

      <label for="ing-stock" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Current stock</label>
      <input
        id="ing-stock"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formStock}
      />

      <label for="ing-cost" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Unit cost ($)</label>
      <input
        id="ing-cost"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formCost}
      />

      <label for="ing-threshold" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">
        Reorder threshold
      </label>
      <input
        id="ing-threshold"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formThreshold}
      />
      <div class="mb-4 -mt-3 text-xs text-counter-muted">Flagged as low stock on the Dashboard once stock drops to this level or below.</div>

      <label for="ing-quantity" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">
        Reorder quantity
      </label>
      <input
        id="ing-quantity"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formQuantity}
      />
      <div class="mb-4 -mt-3 text-xs text-counter-muted">Suggested amount to order when this shows up on the restock list.</div>

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
