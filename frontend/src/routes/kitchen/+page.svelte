<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import type { MockTicket, TicketStatus } from '$lib/mockData';
  import { apiJson } from '$lib/api';
  import { auth, logout } from '$lib/stores/auth';
  import Ticket from '$lib/components/Ticket.svelte';
  import type { OrderRow, KitchenStatus } from '$lib/orders';

  // Tickets are real orders polled from the backend — not local component
  // state — so "advance" always writes through the server before the rail
  // reflects it (avoids a fast poll clobbering an optimistic local update).
  let orders: OrderRow[] = [];
  let filter: 'all' | 'dine_in' | 'to_go' | 'delivery' = 'all';
  let now = '';
  let loadError = '';
  let nowTick = Date.now();

  const POLL_MS = 4000;
  const LATE_THRESHOLD_MINUTES = 8;

  const nextKitchenStatus: Record<KitchenStatus, KitchenStatus> = {
    new: 'cooking',
    cooking: 'ready',
    ready: 'completed',
    completed: 'completed',
  };

  function elapsedLabel(timestamp: string, tick: number): string {
    const totalSeconds = Math.max(0, Math.floor((tick - new Date(timestamp).getTime()) / 1000));
    const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
    const ss = String(totalSeconds % 60).padStart(2, '0');
    return `${mm}:${ss}`;
  }

  function toTicket(order: OrderRow, tick: number): MockTicket {
    const minutesElapsed = (tick - new Date(order.timestamp).getTime()) / 60000;
    const displayStatus: TicketStatus =
      order.kitchen_status === 'ready'
        ? 'ready'
        : minutesElapsed > LATE_THRESHOLD_MINUTES
          ? 'late'
          : (order.kitchen_status as TicketStatus);

    return {
      orderId: String(order.id),
      type: order.type,
      table: order.table_identifier ?? undefined,
      customerName: order.customer_name ?? undefined,
      server: order.server_name ?? undefined,
      status: displayStatus,
      elapsed: elapsedLabel(order.timestamp, tick),
      lines: order.items.map((i) => ({ quantity: i.quantity, name: i.name, note: i.note ?? undefined })),
    };
  }

  async function loadOrders() {
    try {
      orders = await apiJson<OrderRow[]>('/api/orders?kitchen_status=new,cooking,ready');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load kitchen tickets';
    }
  }

  async function advance(orderIdStr: string) {
    const id = Number(orderIdStr);
    const order = orders.find((o) => o.id === id);
    if (!order) return;
    try {
      await apiJson(`/api/orders/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ kitchen_status: nextKitchenStatus[order.kitchen_status] }),
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

    const updateClock = () =>
      (now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
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

  $: tickets = orders.map((o) => toTicket(o, nowTick));
  $: visibleTickets = filter === 'all' ? tickets : tickets.filter((t) => t.type === filter);
  $: activeCount = tickets.filter((t) => t.status !== 'ready').length;
  $: lateCount = tickets.filter((t) => t.status === 'late').length;
</script>

<svelte:head>
  <title>Kitchen · OpenEats</title>
</svelte:head>

<div class="flex h-screen w-full flex-col overflow-hidden bg-kds-bg text-kds-text">
  <!-- top bar -->
  <div class="flex h-[72px] flex-none items-center gap-5 border-b border-kds-border px-5">
    <div class="text-xl font-black tracking-tight sm:text-[22px]">KITCHEN</div>

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
    <div class="hidden font-mono text-sm text-kds-muted lg:block">{$auth.user?.name} · {$auth.user?.role}</div>
    <button
      class="text-sm font-bold text-kds-muted hover:text-kds-text"
      on:click={() => {
        logout();
        goto('/login');
      }}
    >
      Sign out
    </button>
    {#if $auth.user?.role !== 'kitchen'}
      <a href="/" class="text-sm font-bold text-kds-muted hover:text-kds-text">Exit ↗</a>
    {/if}
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
