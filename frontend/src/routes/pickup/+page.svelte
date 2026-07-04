<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { apiJson } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import type { OrderRow, KitchenStatus } from '$lib/orders';
  import TypeBadge from '$lib/components/TypeBadge.svelte';
  import TopBarNav from '$lib/components/TopBarNav.svelte';

  const navLinks = [
    { href: '/', label: 'Order' },
    { href: '/tables', label: 'Tables' },
    { href: '/punch', label: 'Time Clock' },
  ];

  // To-go/delivery orders have no table, so once the kitchen clears them off
  // the KDS (kitchen_status -> 'completed') they'd otherwise vanish from view
  // entirely — this is where front-of-house sees them and checks them out.
  let orders: OrderRow[] = [];
  let loading = true;
  let loadError = '';

  const POLL_MS = 5000;

  const statusRank: Record<KitchenStatus, number> = { completed: 0, ready: 1, cooking: 2, new: 3 };
  const statusLabel: Record<KitchenStatus, string> = {
    new: 'Ordered',
    cooking: 'Cooking',
    ready: 'Ready',
    completed: 'Ready for pickup',
  };
  const statusClass: Record<KitchenStatus, string> = {
    new: 'bg-[#F3EBFF] text-[#6D28D9]',
    cooking: 'bg-[#FFF7E6] text-[#A16207]',
    ready: 'bg-[#E7F7EE] text-[#0F7A4F]',
    completed: 'bg-counter-paid text-white',
  };

  async function loadOrders() {
    try {
      orders = await apiJson<OrderRow[]>('/api/orders?type=to_go,delivery&payment_status=unpaid');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load pickup orders';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    loadOrders();
    const pollId = setInterval(loadOrders, POLL_MS);
    return () => clearInterval(pollId);
  });

  function minutesAgo(timestamp: string): number {
    return Math.max(0, Math.round((Date.now() - new Date(timestamp).getTime()) / 60000));
  }

  $: sorted = [...orders].sort((a, b) => statusRank[a.kitchen_status] - statusRank[b.kitchen_status]);
</script>

<svelte:head>
  <title>Pickup · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
  <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
    <div class="text-lg font-extrabold text-counter-ink">Pickup</div>
    <div class="font-mono text-sm text-counter-muted">{orders.length} open</div>
    <div class="flex-1"></div>
    <TopBarNav links={navLinks} />
  </div>

  {#if loadError}
    <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">{loadError}</div>
  {/if}

  <div class="flex-1 overflow-y-auto p-4 sm:p-5">
    {#if loading}
      <div class="px-2 py-10 text-center text-sm text-counter-muted">Loading…</div>
    {:else if sorted.length === 0}
      <div class="px-2 py-10 text-center text-sm text-counter-muted">No open to-go or delivery orders.</div>
    {:else}
      <div class="mx-auto flex max-w-2xl flex-col gap-3">
        {#each sorted as order (order.id)}
          <div class="flex items-center gap-4 rounded-2xl border border-counter-line bg-white p-4">
            <div class="min-w-0 flex-1">
              <div class="mb-1 flex items-center gap-2">
                <TypeBadge type={order.type} />
                <span class="rounded-md px-2 py-1 text-xs font-extrabold uppercase tracking-wide {statusClass[order.kitchen_status]}">
                  {statusLabel[order.kitchen_status]}
                </span>
              </div>
              <div class="text-lg font-extrabold text-counter-ink">{order.customer_name ?? `Order #${order.id}`}</div>
              <div class="mt-0.5 truncate font-mono text-xs text-counter-muted">
                {order.items.map((i) => `${i.quantity}× ${i.name}`).join(', ')}
              </div>
              <div class="mt-0.5 font-mono text-xs text-counter-faint">
                #{order.id} · {minutesAgo(order.timestamp)} min ago
              </div>
            </div>
            <div class="flex-none text-right">
              <div class="mb-2 font-mono text-lg font-extrabold text-counter-ink">${order.total.toFixed(2)}</div>
              <button
                class="h-11 rounded-lg bg-counter-paid px-4 text-sm font-extrabold text-white shadow-[0_3px_0_#0F5D3F]"
                on:click={() => goto(`/checkout?order=${order.id}`)}
              >
                Charge →
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
