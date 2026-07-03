<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { KDS_TICKETS } from '$lib/mockData';
  import type { MockTicket, TicketStatus } from '$lib/mockData';
  import { auth, logout } from '$lib/stores/auth';
  import Ticket from '$lib/components/Ticket.svelte';

  let tickets: MockTicket[] = KDS_TICKETS.map((t) => ({ ...t }));
  let filter: 'all' | 'dine_in' | 'to_go' | 'delivery' = 'all';
  let now = '';

  onMount(() => {
    const update = () =>
      (now = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    update();
    const id = setInterval(update, 1000 * 30);
    return () => clearInterval(id);
  });

  const filters: { key: typeof filter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'dine_in', label: 'Dine In' },
    { key: 'to_go', label: 'To Go' },
    { key: 'delivery', label: 'Delivery' },
  ];

  const nextStatus: Record<TicketStatus, TicketStatus> = {
    new: 'cooking',
    cooking: 'ready',
    late: 'ready',
    ready: 'ready',
  };

  function advance(orderId: string) {
    // A ticket that's already "ready" gets cleared off the rail entirely —
    // that's the "Clear / Handed Off" action, not a status transition.
    tickets = tickets.flatMap((t) => {
      if (t.orderId !== orderId) return [t];
      return t.status === 'ready' ? [] : [{ ...t, status: nextStatus[t.status] }];
    });
  }

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
