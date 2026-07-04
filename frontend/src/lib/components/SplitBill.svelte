<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { apiJson } from '$lib/api';
  import Keypad from './Keypad.svelte';

  interface SplitLine {
    id: number;
    name: string;
    unit_price: number;
    quantity: number;
    note?: string;
    adjustment_total: number;
  }
  interface Guest {
    id: number;
    label: string;
    paid: boolean;
  }

  export let tableIdentifier: string;
  export let orderIds: number[];
  export let cartLines: SplitLine[];
  export let taxRate: number;
  export let tableTotal: number;
  export let alreadyCollected: number;
  // How many seat columns to start with — a bar with 10 seats (each paying
  // separately) and a 2-top both split "by who's sitting where" using
  // whatever seat count is already configured for the table, rather than a
  // generic guest counter.
  export let tableSeats = 2;
  export let acceptTips = false;
  export let ccFeePercent = 0;

  const dispatch = createEventDispatcher<{ settled: void }>();

  let nextGuestId = 1;
  function makeSeatGuests(count: number): Guest[] {
    const n = Math.max(1, Math.min(Math.round(count) || 2, 30));
    return Array.from({ length: n }, (_, i) => ({ id: nextGuestId++, label: `Seat ${i + 1}`, paid: false }));
  }
  let guests: Guest[] = makeSeatGuests(tableSeats);
  // line id -> guest ids sharing that line evenly
  let assignments: Record<number, number[]> = {};
  let expandedSplitFor: number | null = null;
  let draggingLineId: number | null = null;

  let chargingGuestId: number | null = null;
  let entry = '';
  let chargeTenderType: 'cash' | 'card' = 'cash';
  const chargeTenderOptions = [
    { key: 'cash' as const, label: 'Cash' },
    { key: 'card' as const, label: 'Card' },
  ];
  let chargeError = '';
  let charging = false;
  let sessionCollected = 0;

  let chargeTipPct: number | null = 0;
  let chargeCustomTip = '';
  const chargeTipPresets = [0, 15, 18, 20];

  function addGuest() {
    guests = [...guests, { id: nextGuestId++, label: `Seat ${guests.length + 1}`, paid: false }];
  }

  function assignWhole(lineId: number, guestId: number) {
    assignments = { ...assignments, [lineId]: [guestId] };
  }

  function unassign(lineId: number) {
    const next = { ...assignments };
    delete next[lineId];
    assignments = next;
  }

  function toggleSplitGuest(lineId: number, guestId: number) {
    const current = assignments[lineId] ?? [];
    const next = current.includes(guestId) ? current.filter((id) => id !== guestId) : [...current, guestId];
    assignments = { ...assignments, [lineId]: next };
  }

  $: guestBreakdown = guests.map((guest) => {
    const lines = cartLines
      .filter((line) => (assignments[line.id] ?? []).includes(guest.id))
      .map((line) => {
        const shareCount = assignments[line.id].length;
        // Net of any void/comp/discount recorded against this specific
        // line — a comped item assigned to a guest shouldn't still bill
        // them for it, and a fully voided line nets to $0.
        const netLine = Math.max(0, line.unit_price * line.quantity - (line.adjustment_total ?? 0));
        return { line, share: 1 / shareCount, lineTotal: netLine / shareCount };
      });
    const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
    const tax = subtotal * taxRate;
    return { guest, lines, subtotal, tax, total: subtotal + tax };
  });

  $: remainingPool = Math.max(0, tableTotal - alreadyCollected - sessionCollected);

  // What's actually owed by the guest currently in the charge modal — same
  // "cap to whatever's left" safeguard used everywhere else in this
  // component, in case a prior session already collected part of this table.
  $: chargingBreakdown = guestBreakdown.find((b) => b.guest.id === chargingGuestId);
  $: chargingTotal = chargingBreakdown ? Math.min(Math.round(chargingBreakdown.total * 100) / 100, remainingPool) : 0;

  $: chargeTipAmount =
    chargeTipPct !== null ? Math.round(chargingTotal * (chargeTipPct / 100) * 100) / 100 : Number(chargeCustomTip) || 0;
  $: chargeCardFeeAmount =
    chargeTenderType === 'card' && ccFeePercent > 0 ? Math.round(chargingTotal * ccFeePercent * 100) / 100 : 0;
  $: chargingTotalWithExtras = chargingTotal + chargeTipAmount + chargeCardFeeAmount;

  // Tendered/change-due, mirroring the main checkout tender panel exactly.
  $: tendered = entry ? Number(entry) : Math.ceil(chargingTotalWithExtras / 10) * 10 + 10;
  $: changeDue = Math.max(0, tendered - chargingTotalWithExtras);
  $: canCharge = chargingTotal > 0 && tendered >= chargingTotalWithExtras;
  $: chargeBase10 = Math.ceil(chargingTotalWithExtras / 10) * 10;
  $: quickCash = [
    Math.ceil(chargingTotalWithExtras),
    Math.ceil(chargingTotalWithExtras / 5) * 5,
    chargeBase10 + 10,
    chargeBase10 + 20,
  ];

  function startCharge(guestId: number) {
    const breakdown = guestBreakdown.find((b) => b.guest.id === guestId);
    if (!breakdown || breakdown.total <= 0) return;
    chargingGuestId = guestId;
    entry = '';
    chargeTenderType = 'cash';
    chargeError = '';
    chargeTipPct = 0;
    chargeCustomTip = '';
  }

  function pressKey(k: string) {
    if (k === '⌫') {
      entry = entry.slice(0, -1);
      return;
    }
    if (k === '.' && entry.includes('.')) return;
    entry = (entry + k).slice(0, 7);
  }

  async function confirmCharge() {
    const breakdown = chargingBreakdown;
    if (!breakdown || !canCharge) return;
    const total = chargingTotal;

    charging = true;
    chargeError = '';
    try {
      const scale = breakdown.subtotal > 0 ? total / (breakdown.subtotal + breakdown.tax) : 0;
      const res = await apiJson<{ settled: boolean }>('/api/guest-payments', {
        method: 'POST',
        body: JSON.stringify({
          table_identifier: tableIdentifier,
          order_ids: orderIds,
          guest_label: breakdown.guest.label,
          subtotal: breakdown.subtotal * scale,
          tax: breakdown.tax * scale,
          total,
          tender_type: chargeTenderType,
          tendered_amount: tendered,
          items_summary: breakdown.lines.map((l) => ({
            name: l.line.name,
            quantity: l.line.quantity,
            share: l.share,
            line_total: l.lineTotal,
          })),
          tip_amount: chargeTipAmount,
          cash_amount: chargeTenderType === 'cash' ? total : 0,
          card_amount: chargeTenderType === 'card' ? total : 0,
        }),
      });
      guests = guests.map((g) => (g.id === chargingGuestId ? { ...g, paid: true } : g));
      sessionCollected += total;
      chargingGuestId = null;
      if (res.settled) dispatch('settled');
    } catch (e) {
      chargeError = e instanceof Error ? e.message : 'Failed to charge this guest';
    } finally {
      charging = false;
    }
  }
</script>

<div class="flex flex-1 flex-col gap-3 overflow-y-auto">
  {#if alreadyCollected > 0}
    <div class="rounded-lg bg-counter-cream px-3 py-2 text-xs font-semibold text-counter-muted-2">
      Already collected ${alreadyCollected.toFixed(2)} of ${tableTotal.toFixed(2)} — ${remainingPool.toFixed(2)} left to split.
    </div>
  {/if}

  <div>
    <div class="mb-1.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
      Items — drag onto a guest, or split evenly across several
    </div>
    <div class="flex flex-wrap gap-2">
      {#each cartLines as line (line.id)}
        {@const assignedGuests = assignments[line.id] ?? []}
        <div
          class="cursor-grab rounded-lg border px-3 py-2 text-sm {assignedGuests.length > 0
            ? 'border-counter-paid bg-[#E7F7EE]'
            : 'border-counter-line bg-white'}"
          role="button"
          tabindex="0"
          draggable="true"
          on:dragstart={() => (draggingLineId = line.id)}
        >
          <div class="font-semibold text-counter-ink">
            {line.quantity}× {line.name}
            {#if line.adjustment_total > 0}
              <span class="text-counter-orange-dark">
                {line.adjustment_total >= line.unit_price * line.quantity ? '(voided)' : '(adjusted)'}
              </span>
            {/if}
          </div>
          <div class="text-xs text-counter-muted-2">
            {#if assignedGuests.length === 0}
              Unassigned
            {:else}
              → {assignedGuests.map((id) => guests.find((g) => g.id === id)?.label).join(', ')}
            {/if}
          </div>
          <button
            class="mt-1 text-xs font-bold text-counter-muted-2 underline"
            on:click={() => (expandedSplitFor = expandedSplitFor === line.id ? null : line.id)}
          >
            Split evenly among…
          </button>
          {#if expandedSplitFor === line.id}
            <div class="mt-1.5 flex flex-wrap gap-1.5 border-t border-counter-paper pt-1.5">
              {#each guests as guest (guest.id)}
                <label class="flex items-center gap-1 text-xs text-counter-ink">
                  <input
                    type="checkbox"
                    checked={assignedGuests.includes(guest.id)}
                    on:change={() => toggleSplitGuest(line.id, guest.id)}
                  />
                  {guest.label}
                </label>
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  </div>

  <div class="grid flex-1 grid-cols-2 gap-2 overflow-x-auto sm:grid-cols-3">
    {#each guestBreakdown as { guest, lines, total } (guest.id)}
      <div
        class="flex min-w-[150px] flex-col rounded-xl border border-counter-line bg-counter-cream p-3"
        role="button"
        tabindex="0"
        on:dragover|preventDefault
        on:drop={() => draggingLineId !== null && assignWhole(draggingLineId, guest.id)}
      >
        <div class="mb-1.5 text-sm font-extrabold text-counter-ink">{guest.label}</div>
        <div class="mb-2 flex-1 space-y-1">
          {#each lines as { line, share }}
            <div class="flex items-center justify-between text-xs text-counter-muted-2">
              <button class="text-left hover:text-counter-orange-dark" title="Remove" on:click={() => unassign(line.id)}>
                {share < 1 ? `${line.name} (${Math.round(share * 100)}%)` : line.name}
              </button>
            </div>
          {/each}
        </div>
        <div class="mb-2 font-mono text-lg font-extrabold text-counter-ink">${total.toFixed(2)}</div>
        {#if guest.paid}
          <div class="rounded-lg bg-counter-paid/10 py-2 text-center text-sm font-bold text-counter-paid">Paid ✓</div>
        {:else}
          <button
            class="h-10 rounded-lg bg-counter-ink text-sm font-bold text-white disabled:opacity-40"
            disabled={total <= 0}
            on:click={() => startCharge(guest.id)}
          >
            Charge →
          </button>
        {/if}
      </div>
    {/each}
    <button
      class="flex min-h-[100px] min-w-[120px] items-center justify-center rounded-xl border border-dashed border-counter-line text-sm font-bold text-counter-muted-2"
      on:click={addGuest}
    >
      + Add seat
    </button>
  </div>

  {#if chargingGuestId !== null}
    <div class="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
      <div class="w-[360px] rounded-2xl bg-white p-5">
        <div class="mb-3 flex items-center justify-between">
          <div class="text-lg font-extrabold text-counter-ink">Charge {chargingBreakdown?.guest.label}</div>
          <button class="text-sm font-bold text-counter-muted-2" on:click={() => (chargingGuestId = null)}>Close</button>
        </div>
        <div class="mb-3 grid grid-cols-2 gap-2">
          {#each chargeTenderOptions as t (t.key)}
            <button
              class="h-11 rounded-xl text-[15px] font-bold {chargeTenderType === t.key
                ? 'bg-counter-ink text-white'
                : 'bg-counter-paper text-counter-muted-2'}"
              on:click={() => (chargeTenderType = t.key)}
            >
              {t.label}
            </button>
          {/each}
        </div>

        {#if acceptTips}
          <div class="mb-3">
            <div class="mb-1.5 text-xs font-bold uppercase tracking-wide text-counter-muted">Tip</div>
            <div class="grid grid-cols-4 gap-2">
              {#each chargeTipPresets as pct}
                <button
                  class="h-9 rounded-lg text-sm font-bold {chargeTipPct === pct
                    ? 'bg-counter-ink text-white'
                    : 'bg-counter-paper text-counter-ink'}"
                  on:click={() => {
                    chargeTipPct = pct;
                    chargeCustomTip = '';
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
              class="mt-2 h-9 w-full rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-sm text-counter-ink"
              bind:value={chargeCustomTip}
              on:input={() => (chargeTipPct = null)}
            />
          </div>
        {/if}

        <div class="mb-3 rounded-xl border border-[#E7E0D1] bg-counter-cream p-4">
          <div class="flex items-baseline justify-between">
            <span class="text-sm font-semibold text-counter-muted">Owed</span>
            <span class="font-mono text-lg font-extrabold text-counter-ink">${chargingTotal.toFixed(2)}</span>
          </div>
          {#if chargeTipAmount > 0}
            <div class="flex items-baseline justify-between text-sm text-counter-muted-2">
              <span>Tip</span><span class="font-mono">${chargeTipAmount.toFixed(2)}</span>
            </div>
          {/if}
          {#if chargeCardFeeAmount > 0}
            <div class="flex items-baseline justify-between text-sm text-counter-muted-2">
              <span>Card fee</span><span class="font-mono">${chargeCardFeeAmount.toFixed(2)}</span>
            </div>
          {/if}
          <div class="my-2 border-t border-dashed border-counter-dashed"></div>
          <div class="flex items-baseline justify-between">
            <span class="text-sm font-semibold text-counter-muted">Tendered</span>
            <span class="font-mono text-[22px] font-extrabold text-counter-ink">${tendered.toFixed(2)}</span>
          </div>
          <div class="my-2 border-t border-dashed border-counter-dashed"></div>
          <div class="flex items-baseline justify-between">
            <span class="text-sm font-semibold text-counter-paid">Change due</span>
            <span class="font-mono text-[22px] font-extrabold text-counter-paid">${changeDue.toFixed(2)}</span>
          </div>
        </div>

        <div class="mb-3 grid grid-cols-4 gap-2">
          {#each quickCash as amt}
            <button
              class="h-10 rounded-lg text-sm font-bold {!entry && tendered === amt
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
        {#if chargeError}
          <div class="mt-2 text-sm font-semibold text-counter-orange-dark">{chargeError}</div>
        {/if}
        <button
          class="mt-3 h-14 w-full rounded-xl bg-counter-paid text-lg font-extrabold text-white disabled:opacity-50"
          disabled={!canCharge || charging}
          on:click={confirmCharge}
        >
          {charging ? 'Charging…' : `Tender $${tendered.toFixed(2)} · Charge`}
        </button>
      </div>
    </div>
  {/if}
</div>
