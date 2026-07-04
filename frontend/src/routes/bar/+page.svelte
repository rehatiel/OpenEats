<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { settings } from '$lib/stores/settings';
  import Ticket from '$lib/components/Ticket.svelte';
  import TopBarNav from '$lib/components/TopBarNav.svelte';
  import KitchenTicketPrint from '$lib/components/KitchenTicketPrint.svelte';
  import type { OrderRow } from '$lib/orders';
  import { toTicket, stationStatus, nextItemStatus } from '$lib/kds';
  import { createPrintQueue } from '$lib/printQueue';

  const STATION = 'bar' as const;
  const navLinks = [{ href: '/', label: 'Exit ↗' }];

  // Same real-orders-polled-from-the-backend approach as the Kitchen
  // Display (see frontend/src/routes/kitchen/+page.svelte) — "advance"
  // always writes through the server first.
  let orders: OrderRow[] = [];
  let filter: 'all' | 'dine_in' | 'to_go' | 'delivery' = 'all';
  let now = '';
  let loadError = '';
  let nowTick = Date.now();

  const POLL_MS = 4000;

  // Auto-prints when a ticket this board hasn't shown before shows up —
  // recomputed fresh from each poll's result (not accumulated), so a ticket
  // that leaves the board (bumped to completed) and later somehow
  // reappears still reprints. Skipped on the very first load so
  // opening/refreshing the display doesn't reprint every ticket already in
  // progress.
  let knownOrderIds: Set<number> | null = null;
  const { current: printingOrder, enqueue: enqueuePrint } = createPrintQueue<OrderRow>();

  async function loadOrders() {
    try {
      const fetched = await apiJson<OrderRow[]>('/api/orders?station=bar&kitchen_status=new,cooking,ready');
      // kitchen_status is the order-level rollup across BOTH stations — a
      // mixed order whose bar item is done but whose kitchen items are
      // still pending would still match it. Filter again using the
      // station-specific status so a ticket with nothing left for the bar
      // to do doesn't linger here.
      orders = fetched.filter((o) => stationStatus(o, STATION) !== 'completed');

      if (knownOrderIds) {
        const newOrders = orders.filter((o) => !knownOrderIds!.has(o.id));
        if ($settings.kitchen_printer_enabled) newOrders.forEach(enqueuePrint);
      }
      knownOrderIds = new Set(orders.map((o) => o.id));

      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load bar tickets';
    }
  }

  async function advance(orderIdStr: string) {
    const id = Number(orderIdStr);
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    try {
      await apiJson(`/api/orders/${id}/station-status`, {
        method: 'PATCH',
        body: JSON.stringify({ station: STATION, status: nextItemStatus[stationStatus(order, STATION)] }),
      });
      await loadOrders();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to update ticket';
    }
  }

  onMount(() => {
    loadOrders();
    const pollId = setInterval(loadOrders, POLL_MS);
    const tickId = setInterval(() => (nowTick = Date.now()), 1000);

    const updateClock = () => (now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    updateClock();
    const clockId = setInterval(updateClock, 1000 * 30);

    return () => {
      clearInterval(pollId);
      clearInterval(tickId);
      clearInterval(clockId);
    };
  });

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'dine_in', label: 'Dine In' },
    { key: 'to_go', label: 'To Go' },
    { key: 'delivery', label: 'Delivery' },
  ];

  $: tickets = orders.map((o) => toTicket(o, nowTick, STATION));
  $: visibleTickets = filter === 'all' ? tickets : tickets.filter((t) => t.type === filter);
  $: activeCount = tickets.filter((t) => t.status !== 'ready').length;
  $: lateCount = tickets.filter((t) => t.status === 'late').length;
</script>

<svelte:head>
  <title>Bar · OpenEats</title>
</svelte:head>

<div class="flex h-screen w-full flex-col overflow-hidden bg-kds-bg text-kds-text">
  <!-- top bar -->
  <div class="flex h-[72px] flex-none items-center gap-5 border-b border-kds-border px-5">
    <div class="text-xl font-black tracking-tight sm:text-[22px]">BAR</div>

    <div class="flex items-center gap-2 rounded-lg border border-kds-border bg-kds-card-2 px-3 py-1.5">
      <span class="font-mono text-lg font-extrabold text-kds-cooking sm:text-xl">{activeCount}</span>
      <span class="text-xs font-semibold text-kds-muted">active</span>
    </div>
    <div class="flex items-center gap-2 rounded-lg border border-kds-border bg-kds-card-2 px-3 py-1.5">
      <span class="font-mono text-lg font-extrabold text-kds-late sm:text-xl">{lateCount}</span>
      <span class="text-xs font-semibold text-kds-muted">late</span>
    </div>

    <div class="hidden gap-2 sm:flex">
      {#each filters as f (f.key)}
        <button
          class="rounded-lg border px-3 py-2.5 text-sm font-bold {filter === f.key
            ? 'border-transparent bg-white text-kds-bg'
            : 'border-kds-border bg-kds-card-2 text-kds-muted'}"
          on:click={() => (filter = f.key)}
        >
          {f.label}
        </button>
      {/each}
    </div>

    <div class="flex-1"></div>
    <TopBarNav links={navLinks} theme="kds" />
    <div class="hidden font-mono text-base font-bold sm:block">{now}</div>
  </div>

  {#if loadError}
    <div class="mx-5 mt-3 rounded-lg border border-kds-late bg-kds-card-2 px-4 py-2.5 text-sm font-semibold text-kds-late">
      {loadError}
    </div>
  {/if}

  <!-- ticket rail -->
  <div class="flex flex-1 gap-4 overflow-x-auto overflow-y-hidden p-[18px]">
    {#each visibleTickets as ticket (ticket.orderId)}
      <Ticket {ticket} on:advance={(e) => advance(e.detail)} />
    {/each}
    {#if visibleTickets.length === 0}
      <div class="flex flex-1 items-center justify-center text-kds-muted">No tickets for this filter.</div>
    {/if}
  </div>
</div>

<KitchenTicketPrint
  restaurantName={$settings.restaurant_name}
  stationLabel="BAR"
  ticket={$printingOrder ? toTicket($printingOrder, nowTick, STATION) : null}
/>
