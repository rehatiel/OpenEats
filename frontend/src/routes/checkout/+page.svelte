<script lang="ts">
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { DEMO_CART, DEMO_ORDER_ID } from '$lib/mockData';
  import { settings } from '$lib/stores/settings';
  import { auth, logout } from '$lib/stores/auth';
  import { floorState, clearTable } from '$lib/stores/floorState';
  import TypeBadge from '$lib/components/TypeBadge.svelte';
  import Keypad from '$lib/components/Keypad.svelte';

  // Which table this checkout is for, so completing it can actually clear
  // that table's due amount instead of leaving it stuck — falls back to the
  // fixed demo order when reached without a table (e.g. direct nav).
  $: tableParam = $page.url.searchParams.get('table');
  $: tableEntry = tableParam ? $floorState[tableParam] : undefined;
  $: cartLines = tableEntry?.order ?? DEMO_CART;
  $: orderLabel = `Dine In · Table ${tableParam ?? '4'}`;

  $: subtotal = cartLines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  $: totals = { subtotal, tax: subtotal * $settings.tax_rate, total: subtotal * (1 + $settings.tax_rate) };

  let tenderType: 'cash' | 'card' | 'split' = 'cash';
  let entry = '';

  $: tendered = entry ? Number(entry) : Math.ceil(totals.total / 10) * 10 + 10; // defaults to the $40 quick-cash suggestion
  $: changeDue = Math.max(0, tendered - totals.total);
  $: canComplete = tendered >= totals.total;

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

  function complete() {
    if (!canComplete) return;
    if (tableParam) clearTable(tableParam);
    goto('/tables');
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
      <div class="font-mono text-sm text-counter-muted">#{DEMO_ORDER_ID}</div>
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

    <div class="flex-1 overflow-y-auto px-4 sm:px-5">
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
      disabled={!canComplete}
      on:click={complete}
    >
      Tender ${tendered.toFixed(2)} · Complete
    </button>
  </div>
</div>
