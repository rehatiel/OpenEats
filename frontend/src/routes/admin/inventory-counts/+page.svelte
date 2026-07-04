<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface IngredientRow {
    id: number;
    name: string;
    unit: string;
    current_stock: number;
  }

  interface CountLine {
    id: number;
    ingredient_id: number;
    counted_quantity: number;
    expected_quantity: number;
    variance: number;
    name: string;
    unit: string;
  }

  interface CountRow {
    id: number;
    counted_at: string;
    notes: string | null;
    lines: CountLine[];
  }

  let counts: CountRow[] = [];
  let ingredients: IngredientRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  // ingredient_id -> typed counted-quantity string, so an ingredient left
  // blank is simply skipped rather than submitted as a zero count.
  let formEntries: Record<number, string> = {};
  let formNotes = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      [counts, ingredients] = await Promise.all([
        apiJson<CountRow[]>('/api/inventory-counts'),
        apiJson<IngredientRow[]>('/api/ingredients'),
      ]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load inventory counts';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    formEntries = {};
    formNotes = '';
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const lines = Object.entries(formEntries)
      .filter(([, v]) => v.trim() !== '')
      .map(([ingredientId, v]) => ({ ingredient_id: Number(ingredientId), counted_quantity: Number(v) }));
    if (lines.length === 0) {
      formError = 'Enter a counted quantity for at least one ingredient';
      return;
    }
    if (lines.some((l) => !Number.isFinite(l.counted_quantity) || l.counted_quantity < 0)) {
      formError = 'Counted quantities must be non-negative numbers';
      return;
    }
    saving = true;
    try {
      await apiJson('/api/inventory-counts', {
        method: 'POST',
        body: JSON.stringify({ notes: formNotes.trim() || null, lines }),
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
  <title>Inventory Counts · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Physical inventory counts</div>
      <Button variant="primary" on:click={openAdd}>+ Record count</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else if counts.length === 0}
      <div class="px-2 py-8 text-center text-sm text-counter-muted">No counts recorded yet.</div>
    {:else}
      {#each counts as count (count.id)}
        <div class="mb-4 overflow-hidden rounded-2xl border border-counter-line bg-white">
          <div class="flex items-center justify-between border-b border-counter-paper bg-counter-cream px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
            <span>{new Date(count.counted_at).toLocaleString()}</span>
            {#if count.notes}<span class="normal-case text-counter-muted-2">{count.notes}</span>{/if}
          </div>
          {#each count.lines as line (line.id)}
            <div class="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-2.5 text-[15px] last:border-b-0">
              <div class="font-semibold text-counter-ink">{line.name}</div>
              <div class="font-mono text-sm text-counter-muted-2">expected {line.expected_quantity} {line.unit}</div>
              <div class="font-mono text-sm text-counter-muted-2">counted {line.counted_quantity} {line.unit}</div>
              <div class="font-mono text-sm font-bold {line.variance < 0 ? 'text-counter-orange-dark' : 'text-counter-paid'}">
                {line.variance > 0 ? '+' : ''}{line.variance} {line.unit}
              </div>
            </div>
          {/each}
        </div>
      {/each}
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[380px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Record count</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      {#if ingredients.length === 0}
        <div class="text-sm text-counter-muted">Add ingredients in Admin → Inventory first.</div>
      {:else}
        <div class="mb-4 text-xs text-counter-muted">Leave an ingredient blank to skip it — only entered ones are recorded.</div>
        <div class="mb-4 space-y-2">
          {#each ingredients as ing (ing.id)}
            <div class="flex items-center gap-2">
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm font-semibold text-counter-ink">{ing.name}</div>
                <div class="font-mono text-xs text-counter-muted">system: {ing.current_stock} {ing.unit}</div>
              </div>
              <input
                type="number"
                step="0.01"
                min="0"
                placeholder="Counted"
                class="h-10 w-24 flex-none rounded-lg border border-counter-line bg-counter-paper px-2 font-mono text-sm text-counter-ink"
                bind:value={formEntries[ing.id]}
              />
            </div>
          {/each}
        </div>

        <label for="count-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
        <textarea
          id="count-notes"
          class="mb-4 min-h-[60px] rounded-lg border border-counter-line bg-counter-paper px-3 py-2 text-[15px] text-counter-ink"
          bind:value={formNotes}
        ></textarea>

        {#if formError}
          <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
        {/if}

        <Button variant="success" fullWidth on:click={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save count'}
        </Button>
      {/if}
    </div>
  {/if}
</div>
