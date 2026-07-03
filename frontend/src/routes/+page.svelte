<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { MENU_ITEMS, CATEGORIES } from '$lib/mockData';
  import type { CartLine, OrderType, MockMenuItem, MockTable } from '$lib/mockData';
  import { apiJson } from '$lib/api';
  import { auth, logout } from '$lib/stores/auth';
  import { settings } from '$lib/stores/settings';
  import { summarizeTable, groupOrdersByTable } from '$lib/orders';
  import type { OrderRow } from '$lib/orders';
  import CategoryTabs from '$lib/components/CategoryTabs.svelte';
  import ItemTile from '$lib/components/ItemTile.svelte';
  import CartPanel from '$lib/components/CartPanel.svelte';
  import TableTile from '$lib/components/TableTile.svelte';

  let orderType: OrderType = 'dine_in';
  // Mock menu is the fallback until the real, admin-editable menu loads (or
  // if that fetch fails) — keeps the screen usable rather than blank.
  let menuItems: MockMenuItem[] = MENU_ITEMS;
  let categories: string[] = [...CATEGORIES];
  let activeCategory: string = categories[0];
  let cart: CartLine[] = [];
  let sent = false;
  let sending = false;
  let sendError = '';
  let mobileCartOpen = false;

  // Table selection for dine-in orders — sourced from the same admin-configured
  // table list the floor plan uses, laid out to match the real floor plan so
  // servers unfamiliar with the table numbers can recognize them by position.
  interface TableLayoutRow {
    label: string;
    seats: number;
    shape: 'square' | 'round';
    pos_x: number;
    pos_y: number;
    width: number;
    height: number;
  }
  type PickerTable = MockTable & { pos_x: number; pos_y: number; width: number; height: number };
  let tableOptions: PickerTable[] = [];
  let selectedTable: string | null = null;
  let tablePickerOpen = false;
  let tableError = false;

  $: pickerCanvasWidth = Math.max(480, ...tableOptions.map((t) => t.pos_x + t.width + 48), 0);
  $: pickerCanvasHeight = Math.max(320, ...tableOptions.map((t) => t.pos_y + t.height + 48), 0);

  onMount(async () => {
    try {
      const [layout, unpaidOrders] = await Promise.all([
        apiJson<TableLayoutRow[]>('/api/tables'),
        apiJson<OrderRow[]>('/api/orders?payment_status=unpaid'),
      ]);
      const byTable = groupOrdersByTable(unpaidOrders);
      tableOptions = layout.map((row) => ({
        ...summarizeTable(byTable[row.label]),
        id: row.label,
        seats: row.seats,
        shape: row.shape,
        pos_x: row.pos_x,
        pos_y: row.pos_y,
        width: row.width,
        height: row.height,
      }));
    } catch {
      // Table picker just won't have options; order type toggle still works.
    }

    try {
      const realMenu = await apiJson<MockMenuItem[]>('/api/menu');
      if (realMenu.length) {
        menuItems = realMenu;
        categories = [...new Set(realMenu.map((m) => m.category))];
        if (!categories.includes(activeCategory)) activeCategory = categories[0];
      }
    } catch {
      // Keep the mock menu fallback.
    }
  });

  function pickTable(t: MockTable) {
    selectedTable = t.id;
    tableError = false;
    tablePickerOpen = false;
  }

  const typeToggleActive: Record<OrderType, string> = {
    dine_in: 'bg-counter-dinein text-white',
    to_go: 'bg-counter-orange text-white',
    delivery: 'bg-counter-delivery text-white',
  };
  const typeLabel: Record<OrderType, string> = { dine_in: 'Dine In', to_go: 'To Go', delivery: 'Delivery' };

  $: filteredItems = menuItems.filter((m) => m.category === activeCategory);
  $: tableLabel = orderType === 'dine_in' && selectedTable ? `Table ${selectedTable}` : null;
  $: itemCount = cart.reduce((n, l) => n + l.quantity, 0);
  $: total = cart.reduce((n, l) => n + l.unit_price * l.quantity, 0) * (1 + $settings.tax_rate);

  function qtyFor(id: number) {
    return cart.find((l) => l.menu_item_id === id)?.quantity ?? 0;
  }

  function addItem(item: MockMenuItem) {
    const existing = cart.find((l) => l.menu_item_id === item.id);
    cart = existing
      ? cart.map((l) => (l.menu_item_id === item.id ? { ...l, quantity: l.quantity + 1 } : l))
      : [...cart, { menu_item_id: item.id, name: item.name, unit_price: item.retail_price, quantity: 1 }];
    sent = false;
  }

  function inc(id: number) {
    cart = cart.map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity + 1 } : l));
    sent = false;
  }

  function dec(id: number) {
    cart = cart.map((l) => (l.menu_item_id === id ? { ...l, quantity: l.quantity - 1 } : l)).filter((l) => l.quantity > 0);
    sent = false;
  }

  function setNote(id: number, note: string | undefined) {
    cart = cart.map((l) => (l.menu_item_id === id ? { ...l, note } : l));
  }

  function clearOrder() {
    if (cart.length === 0) return;
    if (!confirm('Clear all items from this order?')) return;
    cart = [];
    sent = false;
    tableError = false;
  }

  async function handleSend() {
    if (orderType === 'dine_in' && !selectedTable) {
      tableError = true;
      tablePickerOpen = true;
      return;
    }
    if (cart.length === 0 || sending) return;

    sending = true;
    sendError = '';
    try {
      await apiJson('/api/orders', {
        method: 'POST',
        body: JSON.stringify({
          type: orderType,
          table_identifier: orderType === 'dine_in' ? selectedTable : null,
          items: cart.map((l) => ({ menu_item_id: l.menu_item_id, quantity: l.quantity, note: l.note })),
        }),
      });
      // Only clear the cart once the kitchen has actually confirmed receipt —
      // otherwise a failed request would silently drop the order.
      cart = [];
      sent = true;
      mobileCartOpen = false;
      setTimeout(() => (sent = false), 2500);
    } catch (e) {
      sendError = e instanceof Error ? e.message : 'Failed to send order to the kitchen';
    } finally {
      sending = false;
    }
  }
</script>

<svelte:head>
  <title>Order · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden lg:flex-row">
  <!-- MAIN -->
  <div class="flex min-w-0 flex-1 flex-col">
    <!-- top bar -->
    <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
      <div class="flex h-9 w-9 flex-none items-center justify-center rounded-lg bg-counter-orange text-lg font-black text-white">
        O
      </div>
      <div class="hidden text-[17px] font-extrabold text-counter-ink sm:block">El Camión</div>

      <div class="flex gap-1.5 rounded-xl bg-counter-tabs p-1.5">
        {#each ['dine_in', 'to_go', 'delivery'] as t (t)}
          <button
            class="rounded-lg px-3 py-2.5 text-sm font-bold sm:px-4 {orderType === t
              ? typeToggleActive[t]
              : 'text-counter-muted-2'}"
            on:click={() => (orderType = t)}
          >
            {typeLabel[t]}
          </button>
        {/each}
      </div>

      {#if orderType === 'dine_in'}
        <button
          class="rounded-lg border px-3 py-2 text-sm font-bold {selectedTable
            ? 'border-counter-line text-counter-ink'
            : 'border-counter-orange text-counter-orange-dark'}"
          on:click={() => (tablePickerOpen = true)}
        >
          {selectedTable ? `Table ${selectedTable}` : 'Select table'}
        </button>
      {/if}

      <div class="flex-1"></div>
      <a href="/tables" class="hidden text-sm font-bold text-counter-muted-2 hover:text-counter-ink md:block">Tables</a>
      {#if $auth.user?.role !== 'staff'}
        <a href="/dashboard" class="hidden text-sm font-bold text-counter-muted-2 hover:text-counter-ink md:block">Dashboard</a>
      {/if}
      <a href="/kitchen" class="hidden text-sm font-bold text-counter-muted-2 hover:text-counter-ink md:block">Kitchen ↗</a>
      {#if $auth.user?.role === 'admin'}
        <a href="/admin/users" class="hidden text-sm font-bold text-counter-muted-2 hover:text-counter-ink md:block">Admin</a>
      {/if}
      <div class="hidden items-center gap-2 lg:flex">
        <div class="font-mono text-[13px] text-counter-muted">{$auth.user?.name} · {$auth.user?.role}</div>
        <button
          class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink"
          on:click={() => {
            logout();
            goto('/login');
          }}
        >
          Sign out
        </button>
      </div>
    </div>

    {#if tableError}
      <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">
        Select a table before sending this dine-in order to the kitchen.
      </div>
    {/if}
    {#if sendError}
      <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">
        {sendError}
      </div>
    {/if}

    <!-- category tabs -->
    <div class="flex-none overflow-x-auto px-4 py-3 sm:px-5">
      <CategoryTabs items={categories} active={activeCategory} on:select={(e) => (activeCategory = e.detail)} />
    </div>

    <!-- grid -->
    <div class="flex-1 overflow-y-auto px-4 pb-28 sm:px-5 lg:pb-5">
      <div class="grid grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-4">
        {#each filteredItems as item (item.id)}
          <ItemTile {item} quantityInCart={qtyFor(item.id)} on:add={() => addItem(item)} />
        {/each}
      </div>
    </div>
  </div>

  <!-- CART: persistent side rail on wide/landscape screens -->
  <div class="hidden lg:flex lg:w-[372px] lg:flex-none lg:flex-col lg:border-l lg:border-counter-line lg:bg-white">
    <CartPanel {cart} {orderType} {tableLabel} {sent} {sending} on:inc={(e) => inc(e.detail)} on:dec={(e) => dec(e.detail)} on:send={handleSend} on:clear={clearOrder} on:note={(e) => setNote(e.detail.id, e.detail.note)} />
  </div>

  <!-- CART: sticky summary bar on narrow/portrait screens -->
  <div class="fixed inset-x-0 bottom-0 flex-none border-t border-counter-line bg-white p-4 lg:hidden">
    <div class="mb-3 flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="flex h-[30px] w-[30px] items-center justify-center rounded-lg bg-counter-ink text-sm font-extrabold text-white">
          {itemCount}
        </div>
        <div class="text-[15px] font-bold text-counter-ink">items in order</div>
      </div>
      <div class="font-mono text-xl font-extrabold text-counter-ink">${total.toFixed(2)}</div>
    </div>
    <button
      class="flex h-[60px] w-full items-center justify-center rounded-xl bg-counter-orange text-lg font-extrabold text-white shadow-[0_3px_0_#B23C14]"
      on:click={() => (mobileCartOpen = true)}
    >
      Review &amp; Send →
    </button>
  </div>

  {#if mobileCartOpen}
    <div
      class="fixed inset-0 z-10 flex flex-col bg-black/40 lg:hidden"
      role="button"
      tabindex="0"
      aria-label="Close cart"
      on:click|self={() => (mobileCartOpen = false)}
      on:keydown={(e) => e.key === 'Escape' && (mobileCartOpen = false)}
    >
      <div class="mt-auto max-h-[85vh] rounded-t-2xl bg-white">
        <CartPanel {cart} {orderType} {tableLabel} {sent} {sending} on:inc={(e) => inc(e.detail)} on:dec={(e) => dec(e.detail)} on:send={handleSend} on:clear={clearOrder} on:note={(e) => setNote(e.detail.id, e.detail.note)} />
      </div>
    </div>
  {/if}

  {#if tablePickerOpen}
    <div
      class="fixed inset-0 z-20 flex items-center justify-center bg-black/40"
      role="button"
      tabindex="0"
      aria-label="Close table picker"
      on:click|self={() => (tablePickerOpen = false)}
      on:keydown={(e) => e.key === 'Escape' && (tablePickerOpen = false)}
    >
      <div class="max-h-[85vh] max-w-[90vw] overflow-auto rounded-2xl bg-white p-6">
        <div class="mb-4 flex items-center justify-between">
          <div class="text-lg font-extrabold text-counter-ink">Select a table</div>
          <button class="text-sm font-bold text-counter-muted-2" on:click={() => (tablePickerOpen = false)}>Close</button>
        </div>
        {#if tableOptions.length === 0}
          <div class="px-2 py-6 text-sm text-counter-muted">No tables configured yet — add some in the admin panel.</div>
        {:else}
          <div
            class="relative overflow-hidden rounded-xl"
            style="width: {pickerCanvasWidth}px; height: {pickerCanvasHeight}px; background-color: #F2EDE3; background-image: linear-gradient(#E7E0D1 1px, transparent 1px), linear-gradient(90deg, #E7E0D1 1px, transparent 1px); background-size: 48px 48px;"
          >
            {#each tableOptions as t (t.id)}
              <div class="absolute" style="left: {t.pos_x}px; top: {t.pos_y}px;">
                <TableTile table={t} width={t.width} height={t.height} selected={t.id === selectedTable} on:select={(e) => pickTable(e.detail)} />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>
