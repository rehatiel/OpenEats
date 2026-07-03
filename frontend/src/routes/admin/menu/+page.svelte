<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface MenuItemRow {
    id: number;
    name: string;
    category: string;
    retail_price: number;
    active: number;
  }

  let items: MenuItemRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let editing: MenuItemRow | null = null;
  let formName = '';
  let formCategory = '';
  let formPrice = '';
  let formError = '';
  let saving = false;

  $: categories = [...new Set(items.map((i) => i.category))].sort();
  $: grouped = categories.map((cat) => ({ cat, rows: items.filter((i) => i.category === cat) }));

  async function load() {
    loading = true;
    try {
      items = await apiJson<MenuItemRow[]>('/api/menu');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load menu';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    editing = null;
    formName = '';
    formCategory = categories[0] ?? '';
    formPrice = '';
    formError = '';
    formOpen = true;
  }

  function openEdit(item: MenuItemRow) {
    editing = item;
    formName = item.name;
    formCategory = item.category;
    formPrice = String(item.retail_price);
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const price = Number(formPrice);
    if (!formName.trim()) {
      formError = 'Name is required';
      return;
    }
    if (!formCategory.trim()) {
      formError = 'Category is required';
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      formError = 'Price must be a non-negative number';
      return;
    }

    saving = true;
    try {
      const body = { name: formName.trim(), category: formCategory.trim(), retail_price: price };
      if (editing) {
        await apiJson(`/api/menu/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiJson('/api/menu', { method: 'POST', body: JSON.stringify(body) });
      }
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function removeItem(item: MenuItemRow) {
    loadError = '';
    try {
      await apiJson(`/api/menu/${item.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Delete failed';
    }
  }
</script>

<svelte:head>
  <title>Menu · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Menu items</div>
      <Button variant="primary" on:click={openAdd}>+ Add item</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      {#each grouped as group (group.cat)}
        <div class="mb-5 overflow-hidden rounded-2xl border border-counter-line bg-white">
          <div class="border-b border-counter-paper bg-counter-cream px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
            {group.cat}
          </div>
          {#each group.rows as item (item.id)}
            <div class="grid grid-cols-[2fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
              <div class="font-semibold text-counter-ink">{item.name}</div>
              <div class="font-mono text-counter-muted-2">${item.retail_price.toFixed(2)}</div>
              <div class="flex justify-end gap-2 text-sm font-bold">
                <button class="text-counter-muted-2 hover:text-counter-ink" on:click={() => openEdit(item)}>Edit</button>
                <button class="text-counter-muted-2 hover:text-counter-orange-dark" on:click={() => removeItem(item)}>Remove</button>
              </div>
            </div>
          {/each}
        </div>
      {/each}
      {#if items.length === 0}
        <div class="px-2 py-8 text-center text-sm text-counter-muted">No menu items yet — add the first one.</div>
      {/if}
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">{editing ? 'Edit item' : 'Add item'}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="menu-name" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Name</label>
      <input
        id="menu-name"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formName}
        placeholder="Item name"
      />

      <label for="menu-category" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Category</label>
      <input
        id="menu-category"
        list="menu-categories"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formCategory}
        placeholder="e.g. Tacos"
      />
      <datalist id="menu-categories">
        {#each categories as cat}
          <option value={cat} />
        {/each}
      </datalist>

      <label for="menu-price" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Price ($)</label>
      <input
        id="menu-price"
        type="number"
        step="0.01"
        min="0"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
        bind:value={formPrice}
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
