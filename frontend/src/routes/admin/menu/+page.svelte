<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson, apiFetch } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface MenuOptionRow {
    id: number;
    label: string;
  }

  interface RecipeLine {
    ingredient_id: number;
    name: string;
    unit: string;
    quantity_required: number;
  }

  interface IngredientRow {
    id: number;
    name: string;
    unit: string;
  }

  interface MenuItemRow {
    id: number;
    name: string;
    category: string;
    retail_price: number;
    active: number;
    image_url: string | null;
    options: MenuOptionRow[];
    recipe: RecipeLine[];
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

  let uploadingImage = false;
  let imageError = '';
  let newOptionLabel = '';
  let optionError = '';
  let savingOption = false;

  let ingredients: IngredientRow[] = [];
  let newRecipeIngredientId: number | null = null;
  let newRecipeQuantity = '';
  let recipeError = '';
  let savingRecipeLine = false;

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

  onMount(() => {
    load();
    apiJson<IngredientRow[]>('/api/ingredients')
      .then((rows) => (ingredients = rows))
      .catch(() => {
        // Recipe section just won't have anything to pick from.
      });
  });

  function openAdd() {
    editing = null;
    formName = '';
    formCategory = categories[0] ?? '';
    formPrice = '';
    formError = '';
    imageError = '';
    optionError = '';
    newOptionLabel = '';
    recipeError = '';
    newRecipeIngredientId = ingredients[0]?.id ?? null;
    newRecipeQuantity = '';
    formOpen = true;
  }

  function openEdit(item: MenuItemRow) {
    editing = item;
    formName = item.name;
    formCategory = item.category;
    formPrice = String(item.retail_price);
    formError = '';
    imageError = '';
    optionError = '';
    newOptionLabel = '';
    recipeError = '';
    newRecipeIngredientId = ingredients[0]?.id ?? null;
    newRecipeQuantity = '';
    formOpen = true;
  }

  // Re-pulls the full menu and re-points `editing` at the fresh copy of the
  // item being edited, so the side panel reflects an image/option change
  // without closing and reopening the form.
  async function refreshEditing() {
    await load();
    if (editing) editing = items.find((i) => i.id === editing!.id) ?? null;
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
        formOpen = false;
        await load();
      } else {
        // Stay in the form, now in edit mode, so a photo/customizations can
        // be added right away — both require an id that doesn't exist yet.
        const created = await apiJson<MenuItemRow>('/api/menu', { method: 'POST', body: JSON.stringify(body) });
        await load();
        editing = items.find((i) => i.id === created.id) ?? created;
      }
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

  function handleImageInput(e: Event) {
    uploadImage((e.target as HTMLInputElement).files);
  }

  async function uploadImage(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file || !editing) return;
    uploadingImage = true;
    imageError = '';
    try {
      const form = new FormData();
      form.append('image', file);
      const res = await apiFetch(`/api/menu/${editing.id}/image`, { method: 'POST', body: form });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? 'Image upload failed');
      }
      await refreshEditing();
    } catch (e) {
      imageError = e instanceof Error ? e.message : 'Image upload failed';
    } finally {
      uploadingImage = false;
    }
  }

  async function addOption() {
    if (!editing || !newOptionLabel.trim()) return;
    savingOption = true;
    optionError = '';
    try {
      await apiJson(`/api/menu/${editing.id}/options`, {
        method: 'POST',
        body: JSON.stringify({ label: newOptionLabel.trim() }),
      });
      newOptionLabel = '';
      await refreshEditing();
    } catch (e) {
      optionError = e instanceof Error ? e.message : 'Failed to add customization';
    } finally {
      savingOption = false;
    }
  }

  async function removeOption(option: MenuOptionRow) {
    if (!editing) return;
    optionError = '';
    try {
      await apiJson(`/api/menu/${editing.id}/options/${option.id}`, { method: 'DELETE' });
      await refreshEditing();
    } catch (e) {
      optionError = e instanceof Error ? e.message : 'Failed to remove customization';
    }
  }

  async function addRecipeLine() {
    if (!editing || !newRecipeIngredientId) return;
    const quantity = Number(newRecipeQuantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      recipeError = 'Quantity must be a positive number';
      return;
    }
    savingRecipeLine = true;
    recipeError = '';
    try {
      await apiJson(`/api/menu/${editing.id}/recipe`, {
        method: 'POST',
        body: JSON.stringify({ ingredient_id: newRecipeIngredientId, quantity_required: quantity }),
      });
      newRecipeQuantity = '';
      await refreshEditing();
    } catch (e) {
      recipeError = e instanceof Error ? e.message : 'Failed to add recipe line';
    } finally {
      savingRecipeLine = false;
    }
  }

  async function removeRecipeLine(line: RecipeLine) {
    if (!editing) return;
    recipeError = '';
    try {
      await apiJson(`/api/menu/${editing.id}/recipe/${line.ingredient_id}`, { method: 'DELETE' });
      await refreshEditing();
    } catch (e) {
      recipeError = e instanceof Error ? e.message : 'Failed to remove recipe line';
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
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
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
        {saving ? 'Saving…' : editing ? 'Save' : 'Save & continue'}
      </Button>

      {#if editing}
        <div class="mt-6 border-t border-counter-paper pt-5">
          <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Photo</div>
          {#if editing.image_url}
            <img src={editing.image_url} alt={editing.name} class="mb-2 h-28 w-full rounded-lg object-cover" />
          {/if}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploadingImage}
            on:change={handleImageInput}
          />
          {#if uploadingImage}
            <div class="mt-1 text-xs text-counter-muted">Uploading…</div>
          {/if}
          {#if imageError}
            <div class="mt-1 text-xs font-semibold text-counter-orange-dark">{imageError}</div>
          {/if}
        </div>

        <div class="mt-6 border-t border-counter-paper pt-5">
          <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Quick customizations</div>
          <div class="mb-3 flex flex-wrap gap-2">
            {#each editing.options as option (option.id)}
              <span class="flex items-center gap-1.5 rounded-full bg-counter-paper px-3 py-1.5 text-sm font-semibold text-counter-ink">
                {option.label}
                <button
                  class="text-counter-muted-2 hover:text-counter-orange-dark"
                  aria-label={`Remove ${option.label}`}
                  on:click={() => removeOption(option)}
                >
                  ✕
                </button>
              </span>
            {/each}
            {#if editing.options.length === 0}
              <div class="text-sm text-counter-muted">No quick customizations yet.</div>
            {/if}
          </div>
          <div class="flex gap-2">
            <input
              class="h-10 min-w-0 flex-1 rounded-lg border border-counter-line bg-counter-paper px-3 text-sm text-counter-ink"
              placeholder="e.g. No pickles"
              bind:value={newOptionLabel}
              on:keydown={(e) => e.key === 'Enter' && addOption()}
            />
            <button
              class="h-10 flex-none rounded-lg bg-counter-ink px-4 text-sm font-bold text-white disabled:opacity-50"
              disabled={savingOption || !newOptionLabel.trim()}
              on:click={addOption}
            >
              Add
            </button>
          </div>
          {#if optionError}
            <div class="mt-1 text-xs font-semibold text-counter-orange-dark">{optionError}</div>
          {/if}
        </div>

        <div class="mt-6 border-t border-counter-paper pt-5">
          <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Recipe</div>
          <div class="mb-3 space-y-1.5">
            {#each editing.recipe as line (line.ingredient_id)}
              <div class="flex items-center justify-between rounded-lg bg-counter-paper px-3 py-2 text-sm">
                <span class="font-semibold text-counter-ink">{line.name}</span>
                <div class="flex items-center gap-2">
                  <span class="font-mono text-counter-muted-2">{line.quantity_required} {line.unit}</span>
                  <button
                    class="text-counter-muted-2 hover:text-counter-orange-dark"
                    aria-label={`Remove ${line.name} from recipe`}
                    on:click={() => removeRecipeLine(line)}
                  >
                    ✕
                  </button>
                </div>
              </div>
            {/each}
            {#if editing.recipe.length === 0}
              <div class="text-sm text-counter-muted">No recipe yet — stock won't deduct when this sells until one's added.</div>
            {/if}
          </div>
          {#if ingredients.length === 0}
            <div class="text-sm text-counter-muted">Add ingredients in Admin → Inventory first.</div>
          {:else}
            <div class="flex gap-2">
              <select
                class="h-10 min-w-0 flex-1 rounded-lg border border-counter-line bg-counter-paper px-2 text-sm text-counter-ink"
                bind:value={newRecipeIngredientId}
              >
                {#each ingredients as ing (ing.id)}
                  <option value={ing.id}>{ing.name} ({ing.unit})</option>
                {/each}
              </select>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Qty"
                class="h-10 w-20 flex-none rounded-lg border border-counter-line bg-counter-paper px-2 font-mono text-sm text-counter-ink"
                bind:value={newRecipeQuantity}
              />
              <button
                class="h-10 flex-none rounded-lg bg-counter-ink px-4 text-sm font-bold text-white disabled:opacity-50"
                disabled={savingRecipeLine || !newRecipeQuantity.trim()}
                on:click={addRecipeLine}
              >
                Add
              </button>
            </div>
          {/if}
          {#if recipeError}
            <div class="mt-1 text-xs font-semibold text-counter-orange-dark">{recipeError}</div>
          {/if}
        </div>
      {/if}
    </div>
  {/if}
</div>
