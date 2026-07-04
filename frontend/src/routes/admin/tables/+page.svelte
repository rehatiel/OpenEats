<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import type { TableLayoutRow } from '$lib/orders';
  import TableTile from '$lib/components/TableTile.svelte';
  import Button from '$lib/components/Button.svelte';

  type TableRow = TableLayoutRow;

  const GRID_SIZE = 48;
  const MIN_SIZE = 64;
  const MAX_SIZE = 320;

  let tables: TableRow[] = [];
  let loading = true;
  let loadError = '';
  let saveError = '';
  let saving = false;
  let dirty = false;
  let selectedId: number | null = null;

  $: selected = tables.find((t) => t.id === selectedId) ?? null;

  // Seats are just ordinary child `tables` rows (see POST
  // /api/tables/:id/seats) — a table can't itself have seats if it's
  // already a seat.
  $: seatCount = selected ? tables.filter((t) => t.parent_table_id === selected!.id).length : 0;
  let seatsInput = '0';
  $: if (selectedId !== null) seatsInput = String(seatCount);
  let seatsSaving = false;
  let seatsError = '';

  async function updateSeats() {
    if (!selected || selected.parent_table_id) return;
    const count = Math.max(0, Math.round(Number(seatsInput)) || 0);
    seatsSaving = true;
    seatsError = '';
    try {
      await apiJson(`/api/tables/${selected.id}/seats`, {
        method: 'POST',
        body: JSON.stringify({ count }),
      });
      await load();
    } catch (e) {
      seatsError = e instanceof Error ? e.message : 'Failed to update seats';
    } finally {
      seatsSaving = false;
    }
  }

  async function load() {
    loading = true;
    try {
      tables = await apiJson<TableRow[]>('/api/tables');
      loadError = '';
      dirty = false;
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load table layout';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function onPointerDown(e: PointerEvent, table: TableRow) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = table.pos_x;
    const origY = table.pos_y;
    let moved = false;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
      table.pos_x = Math.max(0, origX + dx);
      table.pos_y = Math.max(0, origY + dy);
      tables = tables;
    }

    function onUp() {
      if (moved) {
        table.pos_x = Math.round(table.pos_x / GRID_SIZE) * GRID_SIZE;
        table.pos_y = Math.round(table.pos_y / GRID_SIZE) * GRID_SIZE;
        tables = tables;
        dirty = true;
      } else {
        selectedId = table.id;
      }
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    }

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  function onResizePointerDown(e: PointerEvent, table: TableRow) {
    const startX = e.clientX;
    const startY = e.clientY;
    const origW = table.width;
    const origH = table.height;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      table.width = Math.min(MAX_SIZE, Math.max(MIN_SIZE, origW + dx));
      table.height = Math.min(MAX_SIZE, Math.max(MIN_SIZE, origH + dy));
      tables = tables;
    }

    function onUp() {
      table.width = Math.round(table.width / 8) * 8;
      table.height = Math.round(table.height / 8) * 8;
      tables = tables;
      dirty = true;
      target.releasePointerCapture(e.pointerId);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
    }

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
  }

  function updateSelected(patch: Partial<TableRow>) {
    if (!selected) return;
    tables = tables.map((t) => (t.id === selected!.id ? { ...t, ...patch } : t));
    dirty = true;
  }

  function setShape(shape: 'square' | 'round') {
    if (!selected) return;
    const size = shape === 'round' ? 150 : 112;
    updateSelected({ shape, width: size, height: size });
  }

  async function addTable() {
    saveError = '';
    try {
      const created = await apiJson<TableRow>('/api/tables', {
        method: 'POST',
        body: JSON.stringify({ label: String(tables.length + 1), seats: 2, shape: 'square' }),
      });
      tables = [...tables, created];
      selectedId = created.id;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to add table';
    }
  }

  async function deleteSelected() {
    if (!selected) return;
    saveError = '';
    try {
      await apiJson(`/api/tables/${selected.id}`, { method: 'DELETE' });
      tables = tables.filter((t) => t.id !== selected!.id);
      selectedId = null;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to delete table';
    }
  }

  async function saveLayout() {
    saving = true;
    saveError = '';
    try {
      tables = await apiJson<TableRow[]>('/api/tables', {
        method: 'PUT',
        body: JSON.stringify({ tables }),
      });
      dirty = false;
    } catch (e) {
      saveError = e instanceof Error ? e.message : 'Failed to save layout';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>Table layout · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-5">
      <div class="text-xl font-extrabold text-counter-ink">Table layout</div>
      <div class="font-mono text-xs text-counter-muted">Drag tiles to reposition, drag a selected tile's corner to resize</div>
      <div class="flex-1"></div>
      <Button variant="secondary" on:click={addTable}>+ Add table</Button>
      <Button variant="success" on:click={saveLayout} disabled={!dirty || saving}>
        {saving ? 'Saving…' : dirty ? 'Save layout' : 'Saved'}
      </Button>
    </div>

    {#if loadError || saveError}
      <div class="mx-5 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">
        {loadError || saveError}
      </div>
    {/if}

    <div
      class="relative flex-1 overflow-auto"
      style="background-color: #F2EDE3; background-image: linear-gradient(#E7E0D1 1px, transparent 1px), linear-gradient(90deg, #E7E0D1 1px, transparent 1px); background-size: {GRID_SIZE}px {GRID_SIZE}px;"
    >
      {#if loading}
        <div class="p-8 text-center text-sm text-counter-muted">Loading…</div>
      {:else}
        {#each tables as table (table.id)}
          <div
            class="absolute cursor-grab touch-none active:cursor-grabbing"
            style="left: {table.pos_x}px; top: {table.pos_y}px;"
            on:pointerdown={(e) => onPointerDown(e, table)}
          >
            <TableTile
              table={{ id: table.label, seats: table.seats, status: 'open', shape: table.shape, orderable: Boolean(table.orderable) }}
              width={table.width}
              height={table.height}
              selected={table.id === selectedId}
            />
            {#if table.id === selectedId}
              <div
                class="absolute bottom-0 right-0 h-4 w-4 translate-x-1/2 translate-y-1/2 cursor-nwse-resize rounded-sm border-2 border-white bg-counter-ink shadow"
                on:pointerdown|stopPropagation={(e) => onResizePointerDown(e, table)}
                title="Drag to resize"
              ></div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#if selected}
    <div class="flex w-[320px] flex-none flex-col border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Table {selected.label}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (selectedId = null)}>Close</button>
      </div>

      <label for="table-label" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Label</label>
      <input
        id="table-label"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        value={selected.label}
        on:input={(e) => updateSelected({ label: e.currentTarget.value })}
      />

      <label for="table-seats" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Seats</label>
      <input
        id="table-seats"
        type="number"
        min="1"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        value={selected.seats}
        on:input={(e) => updateSelected({ seats: Number(e.currentTarget.value) || 1 })}
      />

      <div id="table-shape-label" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Shape</div>
      <div class="mb-5 flex gap-2" role="group" aria-labelledby="table-shape-label">
        <button
          class="h-11 flex-1 rounded-lg text-sm font-bold {selected.shape === 'square'
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-muted-2'}"
          on:click={() => setShape('square')}
        >
          Square
        </button>
        <button
          class="h-11 flex-1 rounded-lg text-sm font-bold {selected.shape === 'round'
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-muted-2'}"
          on:click={() => setShape('round')}
        >
          Round
        </button>
      </div>

      <div id="table-orderable-label" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">
        Orderable
      </div>
      <div class="mb-1 flex gap-2" role="group" aria-labelledby="table-orderable-label">
        <button
          class="h-11 flex-1 rounded-lg text-sm font-bold {selected.orderable
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-muted-2'}"
          on:click={() => updateSelected({ orderable: 1 })}
        >
          Yes — a table
        </button>
        <button
          class="h-11 flex-1 rounded-lg text-sm font-bold {!selected.orderable
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-muted-2'}"
          on:click={() => updateSelected({ orderable: 0 })}
        >
          No — a landmark
        </button>
      </div>
      <div class="mb-5 font-mono text-[11px] text-counter-faint">
        Landmarks (like a service window) show up on the floor plan but can't be picked as an order destination.
      </div>

      {#if !selected.parent_table_id}
        <label for="table-seat-count" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">
          Seats (bar-style, individually orderable)
        </label>
        <div class="mb-1 flex gap-2">
          <input
            id="table-seat-count"
            type="number"
            min="0"
            class="h-11 flex-1 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
            bind:value={seatsInput}
          />
          <button
            class="h-11 rounded-lg bg-counter-ink px-4 text-sm font-bold text-white disabled:opacity-50"
            disabled={seatsSaving || Number(seatsInput) === seatCount}
            on:click={updateSeats}
          >
            {seatsSaving ? 'Saving…' : 'Update'}
          </button>
        </div>
        {#if seatsError}
          <div class="mb-3 text-xs font-semibold text-counter-orange-dark">{seatsError}</div>
        {/if}
        <div class="mb-5 font-mono text-[11px] text-counter-faint">
          Generates individually-orderable seat tables (e.g. "{selected.label} - Seat 1") clustered under this one — turns
          it into a landmark once it has any. Shrinking is blocked while a seat has an unpaid order.
        </div>
      {/if}

      <div class="mb-1 flex justify-between text-xs font-bold uppercase tracking-wide text-counter-muted">
        <span>Size</span>
        <span class="font-mono normal-case text-counter-faint">drag the tile's corner handle too</span>
      </div>
      <div class="mb-5 flex gap-2">
        <div class="flex-1">
          <label for="table-width" class="mb-1 block text-[11px] text-counter-muted">Width</label>
          <input
            id="table-width"
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            class="h-11 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
            value={selected.width}
            on:input={(e) =>
              updateSelected({ width: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(e.currentTarget.value) || MIN_SIZE)) })}
          />
        </div>
        <div class="flex-1">
          <label for="table-height" class="mb-1 block text-[11px] text-counter-muted">Height</label>
          <input
            id="table-height"
            type="number"
            min={MIN_SIZE}
            max={MAX_SIZE}
            class="h-11 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
            value={selected.height}
            on:input={(e) =>
              updateSelected({ height: Math.min(MAX_SIZE, Math.max(MIN_SIZE, Number(e.currentTarget.value) || MIN_SIZE)) })}
          />
        </div>
      </div>

      <button
        class="h-11 rounded-lg text-sm font-bold text-counter-orange-dark hover:bg-[#FEF0E9]"
        on:click={deleteSelected}
      >
        Delete table
      </button>
    </div>
  {/if}
</div>
