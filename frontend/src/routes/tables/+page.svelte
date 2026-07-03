<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { cartTotals } from '$lib/mockData';
  import type { MockTable } from '$lib/mockData';
  import { apiJson } from '$lib/api';
  import { auth, logout } from '$lib/stores/auth';
  import { floorState } from '$lib/stores/floorState';
  import TableTile from '$lib/components/TableTile.svelte';
  import OrderStatusBadge from '$lib/components/OrderStatusBadge.svelte';
  import Button from '$lib/components/Button.svelte';

  interface TableLayoutRow {
    id: number;
    label: string;
    seats: number;
    shape: 'square' | 'round';
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
  }

  // Live status (status/minutesOpen/total/order) is still mock/in-session
  // data via the shared floorState store — a full live order-lifecycle
  // backend is out of scope here. Layout (position, seats, shape, label) is
  // real, admin-configured data. Merged by `label`, since the DB `id` is an
  // unrelated surrogate key while the mock `id` field is actually the
  // human-facing table number.
  let layout: TableLayoutRow[] = [];
  let loading = true;
  let loadError = '';
  let selectedId = '4';

  $: merged = layout.map((row) => ({
    ...($floorState[row.label] ?? { status: 'open' as const }),
    id: row.label,
    seats: row.seats,
    shape: row.shape,
    pos_x: row.pos_x,
    pos_y: row.pos_y,
    width: row.width,
    height: row.height,
  }));
  $: selected = (merged.find((t) => t.id === selectedId) ?? merged[0]) as (MockTable & {
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
  }) | undefined;
  $: occupiedCount = merged.filter((t) => t.status !== 'open').length;

  onMount(async () => {
    try {
      layout = await apiJson<TableLayoutRow[]>('/api/tables');
      if (layout.length && !layout.some((t) => t.label === selectedId)) {
        selectedId = layout[0].label;
      }
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load table layout';
    } finally {
      loading = false;
    }
  });

  const legend: { label: string; class: string }[] = [
    { label: 'Open', class: 'bg-white border-2 border-counter-dashed' },
    { label: 'Occupied', class: 'bg-counter-dinein' },
    { label: 'Food ready', class: 'bg-counter-paid' },
    { label: 'Needs bill', class: 'bg-counter-orange' },
  ];

  function select(t: MockTable) {
    selectedId = t.id;
  }
</script>

<svelte:head>
  <title>Tables · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
  <!-- top bar -->
  <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
    <div class="text-lg font-extrabold text-counter-ink">Floor</div>
    <div class="font-mono text-sm text-counter-muted">{occupiedCount} of {merged.length} occupied</div>
    <div class="flex-1"></div>
    <div class="hidden items-center gap-4 text-sm font-semibold text-counter-muted-2 md:flex">
      {#each legend as l}
        <div class="flex items-center gap-1.5">
          <span class="h-3.5 w-3.5 rounded {l.class}"></span>
          {l.label}
        </div>
      {/each}
    </div>
    <a href="/" class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink">Order</a>
    <a href="/dashboard" class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink">Dashboard</a>
    {#if $auth.user?.role === 'admin'}
      <a href="/admin/users" class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink">Admin</a>
    {/if}
    <div class="hidden items-center gap-2 lg:flex">
      <div class="font-mono text-[13px] text-counter-muted">{$auth.user?.name} · {$auth.user?.role}</div>
      <button class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink" on:click={() => { logout(); goto('/login'); }}>
        Sign out
      </button>
    </div>
  </div>

  {#if loadError}
    <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">{loadError}</div>
  {/if}

  <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
    <!-- floor canvas -->
    <div
      class="relative flex-1 overflow-auto p-6"
      style="background-color: #F2EDE3; background-image: linear-gradient(#E7E0D1 1px, transparent 1px), linear-gradient(90deg, #E7E0D1 1px, transparent 1px); background-size: 48px 48px;"
    >
      <div class="mb-5 flex justify-center">
        <div class="rounded bg-counter-ink px-6 py-1.5 font-mono text-[11px] font-bold tracking-[0.15em] text-[#E8DFCE]">
          ◤ SERVICE WINDOW ◢
        </div>
      </div>
      {#if loading}
        <div class="text-center text-sm text-counter-muted">Loading floor plan…</div>
      {:else}
        {#each merged as table (table.id)}
          <div class="absolute" style="left: {table.pos_x}px; top: {table.pos_y}px;">
            <TableTile
              {table}
              width={table.width}
              height={table.height}
              selected={table.id === selectedId}
              on:select={(e) => select(e.detail)}
            />
          </div>
        {/each}
        <!-- bar counter (not an order-bearing table) -->
        <div
          class="absolute flex h-[132px] w-[160px] flex-none flex-col items-center justify-center rounded-2xl border-2 border-counter-dashed bg-counter-tabs"
          style="left: 948px; top: 48px;"
        >
          <div class="font-mono text-[11px] font-bold tracking-[0.1em] text-counter-muted">BAR</div>
          <div class="mt-1 text-xl font-extrabold text-counter-ink">B1–B4</div>
          <div class="mt-1 font-mono text-[11px] text-counter-faint">2 seated</div>
        </div>
      {/if}
    </div>

    <!-- selected table rail -->
    {#if selected}
      <div class="flex-none border-t border-counter-line bg-white lg:w-[340px] lg:border-t-0 lg:border-l">
        <div class="border-b border-[#eee6d8] px-5 py-4">
          <div class="mb-1.5 flex items-center justify-between">
            <div class="text-xl font-extrabold text-counter-ink">Table {selected.id}</div>
            <OrderStatusBadge status={selected.status} />
          </div>
          <div class="font-mono text-[13px] text-counter-muted">
            {selected.seats} guests{selected.minutesOpen ? ` · ${selected.minutesOpen} min` : ''}
          </div>
        </div>

        <div class="max-h-[40vh] overflow-y-auto px-3 py-2 lg:max-h-none">
          {#if selected.order}
            {#each selected.order as line}
              <div class="flex justify-between border-b border-counter-paper px-2 py-2.5">
                <span class="text-[15px] font-semibold text-counter-ink">
                  <span class="font-mono text-counter-muted">{line.quantity}×</span>
                  {line.name}{line.note ? ` (${line.note})` : ''}
                </span>
                <span class="font-mono font-bold text-counter-ink">${(line.unit_price * line.quantity).toFixed(2)}</span>
              </div>
            {/each}
          {:else if selected.status === 'open'}
            <div class="px-5 py-8 text-center text-sm text-counter-muted">This table is open — seat a party to start an order.</div>
          {:else}
            <div class="px-5 py-8 text-center text-sm text-counter-muted">Order details aren't itemized in this demo.</div>
          {/if}
        </div>

        <div class="border-t border-[#eee6d8] px-5 py-4">
          <div class="mb-3.5 flex justify-between text-xl font-extrabold text-counter-ink">
            <span>Total</span>
            <span class="font-mono">${(selected.order ? cartTotals(selected.order).total : selected.total ?? 0).toFixed(2)}</span>
          </div>
          <div class="flex gap-2.5">
            <div class="flex-1"><Button variant="secondary" fullWidth on:click={() => goto('/')}>Add items</Button></div>
            <div class="flex-[1.4]"><Button variant="success" fullWidth on:click={() => goto(`/checkout?table=${selected.id}`)}>Checkout</Button></div>
          </div>
        </div>
      </div>
    {/if}
  </div>
</div>
