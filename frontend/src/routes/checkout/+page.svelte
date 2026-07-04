<script lang="ts">
  import { tick } from 'svelte';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { settings } from '$lib/stores/settings';
  import { auth, logout } from '$lib/stores/auth';
  import { apiJson } from '$lib/api';
  import { combineOrderLines, roundCents } from '$lib/orders';
  import type { OrderRow } from '$lib/orders';
  import TypeBadge from '$lib/components/TypeBadge.svelte';
  import Keypad from '$lib/components/Keypad.svelte';
  import Receipt from '$lib/components/Receipt.svelte';
  import SplitBill from '$lib/components/SplitBill.svelte';

  // Checkout is reached two ways: a table (?table=, every unpaid "send to
  // kitchen" round for that table paid off together as one tab) or a single
  // to-go/delivery order (?order=, which has no table — routed here from
  // /pickup instead).
  $: tableParam = $page.url.searchParams.get('table');
  $: orderParam = $page.url.searchParams.get('order');
  // Where to return to when done — a table checkout can be launched from the
  // floor plan (/tables) or the Register queue (/register), and should go
  // back to whichever one sent it here rather than always defaulting to the
  // floor plan.
  $: returnTo = orderParam ? '/pickup' : $page.url.searchParams.get('from') === 'register' ? '/register' : '/tables';

  let orders: OrderRow[] = [];
  let loading = true;
  let loadError = '';
  let completing = false;
  let completeError = '';
  // Set once payment succeeds — swaps the tender panel for a confirmation +
  // print-receipt view instead of navigating away immediately, so there's a
  // chance to print before leaving the screen.
  let completed = false;
  let completedAt = '';
  // Prints a pre-payment bill without waiting for `completed` — the Receipt
  // stays mounted (invisible except under @media print) once requested.
  let billRequested = false;
  // Sum of guest_payments already recorded toward this table's currently
  // unpaid orders — e.g. from an earlier split-bill session that didn't
  // finish, or a resumed page. Never applies to a single to-go/delivery order.
  let alreadyCollected = 0;
  // Drives how many seat columns Split Bill starts with — a 10-seat bar and
  // a 2-top both split "by who's sitting where" using the same seat count
  // already configured for the table, rather than a generic guest counter.
  let tableSeats = 2;

  const typeLabel: Record<string, string> = { dine_in: 'Dine In', to_go: 'To Go', delivery: 'Delivery' };

  async function loadOrders() {
    if (orderParam) {
      loading = true;
      try {
        const order = await apiJson<OrderRow>(`/api/orders/${orderParam}`);
        // Already settled (e.g. a stale link) — nothing left to charge.
        orders = order.payment_status === 'unpaid' ? [order] : [];
        loadError = '';
      } catch (e) {
        loadError = e instanceof Error ? e.message : 'Failed to load this order';
        orders = [];
      } finally {
        loading = false;
      }
      alreadyCollected = 0;
      return;
    }
    if (!tableParam) {
      orders = [];
      loading = false;
      alreadyCollected = 0;
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

    try {
      const currentIds = new Set(orders.map((o) => o.id));
      const payments = await apiJson<{ order_ids: number[]; total: number }[]>(
        `/api/guest-payments?table_identifier=${encodeURIComponent(tableParam)}`
      );
      alreadyCollected = payments
        .filter((p) => p.order_ids.some((id) => currentIds.has(id)))
        .reduce((sum, p) => sum + p.total, 0);
    } catch {
      alreadyCollected = 0;
    }

    try {
      const layout = await apiJson<{ label: string; seats: number }[]>('/api/tables');
      tableSeats = layout.find((t) => t.label === tableParam)?.seats ?? 2;
    } catch {
      tableSeats = 2;
    }
  }

  $: tableParam, orderParam, loadOrders();

  $: cartLines = combineOrderLines(orders);
  $: orderType = orders[0]?.type ?? 'dine_in';
  $: orderLabel = tableParam
    ? `Dine In · Table ${tableParam}`
    : orders[0]
      ? `${typeLabel[orders[0].type]} · ${orders[0].customer_name ?? `#${orders[0].id}`}`
      : 'Checkout';
  $: orderIdLabel = orders.length ? orders.map((o) => `#${o.id}`).join(', ') : '';

  // net_* (not gross subtotal/tax/total) so a voided/comped/discounted item
  // actually reduces what's charged at checkout, not just what's reported.
  $: totals = {
    subtotal: orders.reduce((sum, o) => sum + o.net_subtotal, 0),
    tax: orders.reduce((sum, o) => sum + o.net_tax, 0),
    total: orders.reduce((sum, o) => sum + o.net_total, 0),
  };
  $: adjustmentTotal = orders.reduce((sum, o) => sum + o.adjustment_total, 0);

  // What the plain Tender button actually needs to collect — the full total
  // minus anything a split-bill session has already charged toward this
  // table, so it can never double-charge on top of collected guest payments.
  $: owed = roundCents(Math.max(0, totals.total - alreadyCollected));

  let tenderType: 'cash' | 'card' | 'split' = 'cash';
  let entry = '';

  $: tenderTabs = [
    { key: 'cash' as const, label: 'Cash' },
    { key: 'card' as const, label: 'Card' },
    ...(tableParam ? [{ key: 'split' as const, label: 'Split' }] : []),
  ];

  // Tip selection — a preset % of the bill (before fee), or a typed custom
  // dollar amount. Only applies to the plain (non-split) tender panel; a
  // split-bill guest tips per-charge inside SplitBill instead.
  let tipPct: number | null = 0;
  let customTip = '';
  const tipPresets = [0, 15, 18, 20];
  $: tipAmount = tipPct !== null ? Math.round(owed * (tipPct / 100) * 100) / 100 : Number(customTip) || 0;

  // Card processing fee applies to the bill amount only (not the tip),
  // mirroring how the backend computes cc_fee_amount from card_amount.
  $: cardFeeAmount =
    tenderType === 'card' && $settings.cc_fee_percent > 0 ? Math.round(owed * $settings.cc_fee_percent * 100) / 100 : 0;

  $: owedWithExtras = roundCents(owed + tipAmount + cardFeeAmount);

  $: tendered = entry ? Number(entry) : Math.ceil(owedWithExtras / 10) * 10 + 10; // defaults to the $40 quick-cash suggestion
  $: changeDue = roundCents(Math.max(0, tendered - owedWithExtras));
  // Compare rounded-to-the-cent values on both sides — otherwise a guest
  // typing the exact total can be rejected by leftover floating-point noise
  // in owedWithExtras that never shows up in its displayed $X.XX.
  $: canComplete = orders.length > 0 && roundCents(tendered) >= owedWithExtras;

  $: base10 = Math.ceil(owedWithExtras / 10) * 10;
  $: quickCash = [Math.ceil(owedWithExtras), Math.ceil(owedWithExtras / 5) * 5, base10 + 10, base10 + 20];

  function pressKey(k: string) {
    if (k === '⌫') {
      entry = entry.slice(0, -1);
      return;
    }
    if (k === '.' && entry.includes('.')) return;
    entry = (entry + k).slice(0, 7);
  }

  async function complete() {
    if (!canComplete || completing || (!tableParam && !orderParam)) return;
    completing = true;
    completeError = '';
    try {
      if (orderParam) {
        // Routed through guest-payments too (rather than a plain PATCH) so
        // tips/tenders for to-go orders land in the same place table
        // payments do — the dashboard's tips-by-server report reads only
        // guest_payments. table_identifier is synthetic here since a to-go
        // order has none; nothing keys off it matching a real table.
        const order = orders[0];
        await apiJson<{ settled: boolean }>('/api/guest-payments', {
          method: 'POST',
          body: JSON.stringify({
            table_identifier: `to-go-${order.id}`,
            order_ids: [order.id],
            guest_label: orderLabel,
            subtotal: totals.subtotal,
            tax: totals.tax,
            total: totals.total,
            tender_type: tenderType,
            tendered_amount: tendered,
            items_summary: cartLines.map((l) => ({ name: l.name, quantity: l.quantity, share: 1, line_total: l.unit_price * l.quantity })),
            tip_amount: tipAmount,
            cash_amount: tenderType === 'cash' ? owed : 0,
            card_amount: tenderType === 'card' ? owed : 0,
          }),
        });
      } else {
        // Charges exactly `owed` (the full total minus anything already
        // collected via a split-bill session), through the same endpoint
        // split payments use — there's only ever one place that decides a
        // table's tab is fully paid.
        const scale = totals.total > 0 ? owed / totals.total : 0;
        const res = await apiJson<{ settled: boolean }>('/api/guest-payments', {
          method: 'POST',
          body: JSON.stringify({
            table_identifier: tableParam,
            order_ids: orders.map((o) => o.id),
            guest_label: 'Table',
            subtotal: totals.subtotal * scale,
            tax: totals.tax * scale,
            total: owed,
            tender_type: tenderType,
            tendered_amount: tendered,
            items_summary: cartLines.map((l) => ({ name: l.name, quantity: l.quantity, share: 1, line_total: l.unit_price * l.quantity })),
            tip_amount: tipAmount,
            cash_amount: tenderType === 'cash' ? owed : 0,
            card_amount: tenderType === 'card' ? owed : 0,
          }),
        });
        if (!res.settled) {
          // Only possible if another payment landed for this table between
          // load and now (e.g. a second register) — refresh instead of
          // showing a false "complete".
          completeError = 'This payment was recorded, but the table isn’t fully settled yet — reloading.';
          await loadOrders();
          return;
        }
      }
      // Stay on this screen with a receipt-ready confirmation instead of
      // navigating away immediately — `orders`/`cartLines`/`totals` are left
      // as-is (already loaded) so the receipt has real data to print.
      completedAt = new Date().toISOString();
      completed = true;
    } catch (e) {
      completeError = e instanceof Error ? e.message : 'Failed to complete checkout';
    } finally {
      completing = false;
    }
  }

  function handleSplitSettled() {
    completedAt = new Date().toISOString();
    completed = true;
  }

  async function printBill() {
    if (tableParam) {
      try {
        await apiJson('/api/orders/mark-bill-printed', {
          method: 'PATCH',
          body: JSON.stringify({ table_identifier: tableParam }),
        });
      } catch {
        // Printing still proceeds even if the Register flag couldn't be set.
      }
    }
    billRequested = true;
    await tick();
    window.print();
  }

  function finishUp() {
    goto(returnTo);
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
        class="flex h-11 w-11 flex-none items-center justify-center rounded-lg bg-counter-paper text-lg font-bold text-counter-ink"
        on:click={() => goto(returnTo)}
        aria-label="Back"
      >
        ←
      </button>
      <div class="text-lg font-extrabold text-counter-ink">Checkout</div>
      <TypeBadge type={orderType} label={orderLabel} />
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
          {orderParam ? 'This order has already been charged.' : 'No open orders for this table — nothing to charge.'}
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
      {#if adjustmentTotal > 0}
        <div class="mb-1.5 flex justify-between text-[15px] text-counter-orange-dark">
          <span>Voids/comps/discounts</span><span class="font-mono">-${adjustmentTotal.toFixed(2)}</span>
        </div>
      {/if}
      <div class="mb-1.5 flex justify-between text-[15px] text-counter-muted-2">
        <span>Subtotal</span><span class="font-mono">${totals.subtotal.toFixed(2)}</span>
      </div>
      <div class="flex justify-between text-[15px] text-counter-muted-2">
        <span>Tax ({($settings.tax_rate * 100).toFixed(2)}%)</span><span class="font-mono">${totals.tax.toFixed(2)}</span>
      </div>
      <div class="mt-3 flex justify-between border-t border-dashed border-counter-dashed pt-3 text-[28px] font-black text-counter-ink">
        <span>Total</span><span class="font-mono">${totals.total.toFixed(2)}</span>
      </div>
      {#if alreadyCollected > 0}
        <div class="mt-1.5 flex justify-between text-xs font-semibold text-counter-muted-2">
          <span>Already collected</span><span class="font-mono">-${alreadyCollected.toFixed(2)}</span>
        </div>
        <div class="flex justify-between text-xs font-bold text-counter-orange-dark">
          <span>Remaining</span><span class="font-mono">${owed.toFixed(2)}</span>
        </div>
      {/if}
    </div>
  </div>

  <!-- tender panel -->
  <div class="flex flex-none flex-col gap-4 border-t border-counter-line bg-white p-5 lg:w-[452px] lg:border-l lg:border-t-0">
    {#if completed}
      <div class="flex flex-1 flex-col items-center justify-center gap-5 py-8 text-center">
        <div class="text-2xl font-extrabold text-counter-paid">Payment complete ✓</div>
        <div class="font-mono text-sm text-counter-muted">Total charged: ${(totals.total + tipAmount + cardFeeAmount).toFixed(2)}</div>
        <button
          class="h-[68px] w-full rounded-xl bg-counter-ink text-lg font-extrabold text-white"
          on:click={() => window.print()}
        >
          Print Receipt →
        </button>
        <button
          class="h-14 w-full rounded-xl bg-counter-paper text-[15px] font-bold text-counter-ink"
          on:click={finishUp}
        >
          Done
        </button>
      </div>
    {:else}
      <button
        class="h-11 flex-none rounded-lg border border-counter-line text-sm font-bold text-counter-ink disabled:opacity-40"
        disabled={cartLines.length === 0}
        on:click={printBill}
      >
        Print Bill →
      </button>

      <div class="grid gap-2 {tableParam ? 'grid-cols-3' : 'grid-cols-2'}">
        {#each tenderTabs as t (t.key)}
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

      {#if tenderType === 'split' && tableParam}
        <SplitBill
          tableIdentifier={tableParam}
          orderIds={orders.map((o) => o.id)}
          {cartLines}
          taxRate={$settings.tax_rate}
          tableTotal={totals.total}
          {alreadyCollected}
          {tableSeats}
          acceptTips={$settings.accept_tips}
          ccFeePercent={$settings.cc_fee_percent}
          on:settled={handleSplitSettled}
        />
      {:else}
        <div class="rounded-xl border-2 border-counter-ink bg-counter-cream px-4 py-3 text-center">
          <div class="text-xs font-bold uppercase tracking-wide text-counter-muted">Total Due</div>
          <div class="font-mono text-[42px] font-black leading-tight text-counter-ink">${owedWithExtras.toFixed(2)}</div>
        </div>

        {#if $settings.accept_tips}
          <div>
            <div class="mb-1.5 text-xs font-bold uppercase tracking-wide text-counter-muted">Tip</div>
            <div class="grid grid-cols-4 gap-2">
              {#each tipPresets as pct}
                <button
                  class="h-11 rounded-lg text-sm font-bold {tipPct === pct
                    ? 'bg-counter-ink text-white'
                    : 'bg-counter-paper text-counter-ink'}"
                  on:click={() => {
                    tipPct = pct;
                    customTip = '';
                  }}
                >
                  {pct}%
                </button>
              {/each}
            </div>
            <input
              type="number"
              min="0"
              step="0.01"
              placeholder="Custom tip $"
              class="mt-2 h-10 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-sm text-counter-ink"
              bind:value={customTip}
              on:input={() => (tipPct = null)}
            />
          </div>
        {/if}

        <div class="rounded-xl border border-[#E7E0D1] bg-counter-cream p-4">
          {#if tipAmount > 0}
            <div class="flex items-baseline justify-between text-sm text-counter-muted-2">
              <span>Tip</span><span class="font-mono">${tipAmount.toFixed(2)}</span>
            </div>
          {/if}
          {#if cardFeeAmount > 0}
            <div class="flex items-baseline justify-between text-sm text-counter-muted-2">
              <span>Card processing fee</span><span class="font-mono">${cardFeeAmount.toFixed(2)}</span>
            </div>
          {/if}
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
      {/if}
    {/if}
  </div>
</div>

{#if completed || billRequested}
  <Receipt
    restaurantName={$settings.restaurant_name}
    {orderLabel}
    orderIds={orderIdLabel}
    lines={cartLines}
    totals={completed ? totals : { subtotal: totals.subtotal, tax: totals.tax, total: owed }}
    adjustments={adjustmentTotal}
    taxRate={$settings.tax_rate}
    timestamp={completedAt || new Date().toISOString()}
    settled={completed}
    tipAmount={completed ? tipAmount : 0}
    cardFee={completed ? cardFeeAmount : 0}
    ccFeePercent={$settings.cc_fee_percent}
    paidMessage={$settings.ticket_footer_paid}
    billMessage={$settings.ticket_footer_unpaid}
  />
{/if}
