<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { goto } from '$app/navigation';
  import { apiJson } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { groupOrdersByTable } from '$lib/orders';
  import type { OrderRow } from '$lib/orders';
  import TopBarNav from '$lib/components/TopBarNav.svelte';

  const navLinks = [
    { href: '/', label: 'Order' },
    { href: '/tables', label: 'Tables' },
  ];

  interface TableEntry {
    label: string;
    orders: OrderRow[];
    total: number;
    minutesOpen: number;
    billPrinted: boolean;
    kitchenReady: boolean;
    collected: number;
  }

  let entries: TableEntry[] = [];
  let loading = true;
  let loadError = '';
  let timer: ReturnType<typeof setInterval>;

  async function load() {
    try {
      const orders = await apiJson<OrderRow[]>('/api/orders?type=dine_in&payment_status=unpaid');
      const byTable = groupOrdersByTable(orders);

      const built = await Promise.all(
        Object.entries(byTable).map(async ([label, tableOrders]) => {
          const total = tableOrders.reduce((sum, o) => sum + o.total, 0);
          const oldestMs = Math.min(...tableOrders.map((o) => new Date(o.timestamp).getTime()));
          const minutesOpen = Math.max(0, Math.round((Date.now() - oldestMs) / 60000));
          const billPrinted = tableOrders.every((o) => Boolean(o.bill_printed_at));
          const kitchenReady = tableOrders.every((o) => o.kitchen_status === 'completed');

          let collected = 0;
          try {
            const currentIds = new Set(tableOrders.map((o) => o.id));
            const payments = await apiJson<{ order_ids: number[]; total: number }[]>(
              `/api/guest-payments?table_identifier=${encodeURIComponent(label)}`
            );
            collected = payments
              .filter((p) => p.order_ids.some((id) => currentIds.has(id)))
              .reduce((sum, p) => sum + p.total, 0);
          } catch {
            // No payments recorded yet, or the endpoint hiccuped — 0 is a safe default.
          }

          return { label, orders: tableOrders, total, minutesOpen, billPrinted, kitchenReady, collected };
        })
      );

      // Ready-to-pay tables (bill already printed, or kitchen fully done) surface
      // first — that's the whole point of this screen over hunting the floor plan.
      built.sort((a, b) => {
        const aReady = a.billPrinted || a.kitchenReady ? 0 : 1;
        const bReady = b.billPrinted || b.kitchenReady ? 0 : 1;
        if (aReady !== bReady) return aReady - bReady;
        return b.minutesOpen - a.minutesOpen;
      });

      entries = built;
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load the register';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    load();
    timer = setInterval(load, 5000);
  });
  onDestroy(() => clearInterval(timer));
</script>

<svelte:head>
  <title>Register · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
  <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
    <div class="text-lg font-extrabold text-counter-ink">Register</div>
    <div class="flex-1"></div>
    <TopBarNav links={navLinks} />
  </div>

  <div class="flex-1 overflow-y-auto p-4 sm:p-6">
    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else if entries.length === 0}
      <div class="px-2 py-10 text-center text-sm text-counter-muted">No tables have an open tab right now.</div>
    {:else}
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each entries as entry (entry.label)}
          <div class="rounded-2xl border border-counter-line bg-white p-4">
            <div class="mb-2 flex items-center justify-between">
              <div class="text-lg font-extrabold text-counter-ink">Table {entry.label}</div>
              {#if entry.billPrinted}
                <span class="rounded-full bg-[#E7F7EE] px-2.5 py-0.5 text-xs font-bold text-counter-paid">Bill printed</span>
              {:else if entry.kitchenReady}
                <span class="rounded-full bg-[#FFF7E6] px-2.5 py-0.5 text-xs font-bold text-[#A16207]">Ready to pay</span>
              {/if}
            </div>
            <div class="mb-1 font-mono text-2xl font-extrabold text-counter-ink">${(entry.total - entry.collected).toFixed(2)}</div>
            {#if entry.collected > 0}
              <div class="mb-2 text-xs font-semibold text-counter-muted-2">${entry.collected.toFixed(2)} of ${entry.total.toFixed(2)} collected</div>
            {/if}
            <div class="mb-3 font-mono text-xs text-counter-muted">Open {entry.minutesOpen} min</div>
            <button
              class="h-11 w-full rounded-lg bg-counter-ink text-sm font-bold text-white"
              on:click={() => goto(`/checkout?table=${encodeURIComponent(entry.label)}&from=register`)}
            >
              Charge →
            </button>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
