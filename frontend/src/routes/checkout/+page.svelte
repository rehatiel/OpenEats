<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { settings } from '$lib/stores/settings';
  import { auth, logout } from '$lib/stores/auth';
  import { apiJson } from '$lib/api';
  import { combineOrderLines } from '$lib/orders';
  import type { OrderRow } from '$lib/orders';
  import TypeBadge from '$lib/components/TypeBadge.svelte';
  import Keypad from '$lib/components/Keypad.svelte';

  // Which table this checkout is for — every unpaid order for that table
  // (one per "send to kitchen" round) is fetched and paid off together as
  // one tab, so completing it actually clears the real due amount.
  $: tableParam = $page.url.searchParams.get('table');

  let orders: OrderRow[] = [];
  let loading = true;
  let loadError = '';
  let completing = false;
  let completeError = '';

  async function loadOrders() {
    if (!tableParam) {
      orders = [];
      loading = false;
      return;
    }
    loading = true;
    try {
      orders = await apiJson<OrderRow[]>(
        `/api/orders?table_identifier=${encodeURIComponent(tableParam)}&payment_status=unpaid`
      );
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load this table’s order';
    } finally {
      loading = false;
    }
  }

  $: tableParam, loadOrders();

  $: cartLines = combineOrderLines(orders);
  $: orderLabel = tableParam ? `Dine In · Table ${tableParam}` : 'Checkout';
  $: orderIdLabel = orders.length ? orders.map((o) => `#${o.id}`).join(', ') : '';

  $: totals = {
    subtotal: orders.reduce((sum, o) => sum + o.subtotal, 0),
    tax: orders.reduce((sum, o) => sum + o.tax, 0),
    total: orders.reduce((sum, o) => sum + o.total, 0),
  };

  let tenderType: 'cash' | 'card' | 'split' = 'cash';
  let entry = '';

  $: tendered = entry ? Number(entry) : Math.ceil(totals.total / 10) * 10 + 10; // defaults to the $40 quick-cash suggestion
  $: changeDue = Math.max(0, tendered - totals.total);
  $: canComplete = orders.length > 0 && tendered >= totals.total;

  $: base10 = Math.ceil(totals.total / 10) * 10;
  $: quickCash = [Math.ceil(totals.total), Math.ceil(totals.total / 5) * 5, base10 + 10, base10 + 20];

  function pressKey(k: string) {
    if (k === '⌫') {
      entry = entry.slice(0, -1);
      return;
    }
    if (k === '.' && entry.includes('.')) return;
    entry = (entry + k).slice(0, 7);
  }

  async function complete() {
    if (!canComplete || !tableParam || completing) return;
    completing = true;
    completeError = '';
    try {
      await apiJson('/api/orders/pay-table', {
        method: 'PATCH',
        body: JSON.stringify({ table_identifier: tableParam }),
      });
      goto('/tables');
    } catch (e) {
      completeError = e instanceof Error ? e.message : 'Failed to complete checkout';
    } finally {
      completing = false;
    }
  }
</script>

<svelte:head>
  <title>Checkout · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden lg:flex-row">
  <!-- summary panel -->
  <div class="flex min-w-0 flex-1 flex-col">
    <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
      <button
        class="flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-counter-paper text-lg font-bold text-counter-ink"
        on:click={() => goto('/tables')}
        aria-label="Back"
      >
        ←
      </button>
      <div class="text-lg font-extrabold text-counter-ink">Checkout</div>
      <TypeBadge type="dine_in" label={orderLabel} />
      <div class="flex-1"></div>
      {#if orderIdLabel}
        <div class="font-mono text-sm text-counter-muted">{orderIdLabel}</div>
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

    {#if loadError}
      <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">{loadError}</div>
    {/if}
    {#if completeError}
      <div class="mx-4 mt-3 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C] sm:mx-5">{completeError}</div>
    {/if}

    <div class="flex-1 overflow-y-auto px-4 sm:px-5">
      {#if loading}
        <div class="px-2 py-10 text-center text-sm text-counter-muted">Loading order…</div>
      {:else if cartLines.length === 0}
        <div class="px-2 py-10 text-center text-sm text-counter-muted">
          No open orders for this table — nothing to charge.
        </div>
      {:else}
        {#each cartLines as line}
          <div class="flex items-center justify-between border-b border-[#E7E0D1] py-4">
            <div class="flex items-baseline gap-2">
              <span class="font-mono font-bold text-counter-muted">{line.quantity}×</span>
              <div>
                <div class="text-lg font-bold text-counter-ink">{line.name}</div>
                {#if line.note}
                  <div class="font-mono text-xs text-[#FB7A3C]">{line.note}</div>
                {:else}
                  <div class="font-mono text-xs text-counter-muted">${line.unit_price.toFixed(2)} ea</div>
                {/if}
              </div>
            </div>
            <div class="font-mono text-lg font-bold text-counter-ink">${(line.unit_price * line.quantity).toFixed(2)}</div>
          </div>
        {/each}
      {/if}
    </div>

    <div class="flex-none border-t border-counter-line bg-counter-cream px-4 py-5 sm:px-5">
      <div class="mb-1.5 flex justify-between text-[15px] text-counter-muted-2">
        <span>Subtotal</span><span class="font-mono">${totals.subtotal.toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-[15px] text-counter-muted-2">
        <span>Tax ({($settings.tax_rate * 100).toFixed(2)}%)</span><span class="font-mono">${totals.tax.toFixed(2)}</span>
      </div>
      <div class="mt-3 flex justify-between border-t border-dashed border-counter-dashed pt-3 text-[28px] font-black text-counter-ink">
        <span>Total</span><span class="font-mono">${totals.total.toFixed(2)}</span>
      </div>
    </div>
  </div>

  <!-- tender panel -->
  <div class="flex flex-none flex-col gap-4 border-t border-counter-line bg-white p-5 lg:w-[452px] lg:border-l lg:border-t-0">
    <div class="grid grid-cols-3 gap-2">
      {#each [{ key: 'cash', label: 'Cash' }, { key: 'card', label: 'Card' }, { key: 'split', label: 'Split' }] as t (t.key)}
        <button
          class="h-14 rounded-xl text-[15px] font-bold {tenderType === t.key
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-muted-2'}"
          on:click={() => (tenderType = t.key)}
        >
          {t.label}
        </button>
      {/each}
    </div>

    <div class="rounded-xl border border-[#E7E0D1] bg-counter-cream p-4">
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-semibold text-counter-muted">Tendered</span>
        <span class="font-mono text-[28px] font-extrabold text-counter-ink">${tendered.toFixed(2)}</span>
      </div>
      <div class="my-2 border-t border-dashed border-counter-dashed"></div>
      <div class="flex items-baseline justify-between">
        <span class="text-sm font-semibold text-counter-paid">Change due</span>
        <span class="font-mono text-[28px] font-extrabold text-counter-paid">${changeDue.toFixed(2)}</span>
      </div>
    </div>

    <div class="grid grid-cols-4 gap-2">
      {#each quickCash as amt}
        <button
          class="h-11 rounded-lg text-sm font-bold {!entry && tendered === amt
            ? 'bg-counter-ink text-white'
            : 'bg-counter-paper text-counter-ink'}"
          on:click={() => {
            entry = String(amt);
          }}
        >
          ${amt}
        </button>
      {/each}
    </div>

    <Keypad on:press={(e) => pressKey(e.detail)} />

    <button
      class="h-[68px] rounded-xl bg-counter-paid text-lg font-extrabold text-white shadow-[0_3px_0_#0F5D3F] disabled:opacity-50"
      disabled={!canComplete || completing}
      on:click={complete}
    >
      {completing ? 'Completing…' : `Tender $${tendered.toFixed(2)} · Complete`}
    </button>
  </div>
</div>
