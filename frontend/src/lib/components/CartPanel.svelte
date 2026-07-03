<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CartLine, OrderType } from '$lib/mockData';
  import { settings } from '$lib/stores/settings';
  import TypeBadge from './TypeBadge.svelte';
  import Button from './Button.svelte';

  export let cart: CartLine[];
  export let orderType: OrderType;
  export let orderLabel: string | null = null;
  export let sent = false;
  export let sending = false;

  const dispatch = createEventDispatcher<{
    inc: number;
    dec: number;
    send: void;
    clear: void;
    note: { id: number; note: string | undefined };
  }>();

  $: subtotal = cart.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  $: totals = { subtotal, tax: subtotal * $settings.tax_rate, total: subtotal * (1 + $settings.tax_rate) };
  $: itemCount = cart.reduce((n, l) => n + l.quantity, 0);

  // The "Customize" sheet merges admin-defined quick-customization chips
  // (e.g. "No pickles") with free-text notes into the one `note` string that
  // already flows through to the KDS ticket and checkout — a chip is "on"
  // if its label appears as an exact comma-separated segment of the note;
  // everything else in the note is treated as free text.
  let customizeFor: CartLine | null = null;
  let selectedLabels = new Set<string>();
  let freeText = '';

  function openCustomize(line: CartLine) {
    const segments = (line.note ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const optionLabels = new Set((line.options ?? []).map((o) => o.label));
    selectedLabels = new Set(segments.filter((s) => optionLabels.has(s)));
    freeText = segments.filter((s) => !optionLabels.has(s)).join(', ');
    customizeFor = line;
  }

  function toggleOption(label: string) {
    const next = new Set(selectedLabels);
    if (next.has(label)) next.delete(label);
    else next.add(label);
    selectedLabels = next;
  }

  function saveCustomize() {
    if (!customizeFor) return;
    const orderedLabels = (customizeFor.options ?? [])
      .map((o) => o.label)
      .filter((label) => selectedLabels.has(label));
    const note = [...orderedLabels, freeText.trim()].filter(Boolean).join(', ');
    dispatch('note', { id: customizeFor.menu_item_id, note: note || undefined });
    customizeFor = null;
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex-none border-b border-[#eee6d8] px-5 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="text-lg font-extrabold text-counter-ink">Order</div>
        {#if cart.length > 0}
          <button
            class="rounded-lg px-2 py-1.5 text-xs font-bold text-counter-muted-2 hover:text-counter-orange-dark"
            on:click={() => dispatch('clear')}
          >
            Clear
          </button>
        {/if}
      </div>
      <TypeBadge type={orderType} label={orderLabel ? `${orderType === 'dine_in' ? 'Dine In' : orderType} · ${orderLabel}` : undefined} />
    </div>
  </div>

  <div class="flex-1 overflow-y-auto px-3 py-2">
    {#if cart.length === 0}
      <div class="px-5 py-10 text-center text-sm text-counter-muted">Tap a menu item to add it to the order.</div>
    {/if}
    {#each cart as line (line.menu_item_id)}
      <div class="flex items-center gap-3 border-b border-counter-paper px-2 py-3">
        <div class="min-w-0 flex-1">
          <div class="text-base font-bold text-counter-ink">{line.name}</div>
          <div class="mt-0.5 font-mono text-xs text-counter-muted">
            ${line.unit_price.toFixed(2)} ea{line.note ? ` · ${line.note}` : ''}
          </div>
          <button
            class="mt-1.5 h-11 rounded-lg bg-counter-paper px-4 text-sm font-bold text-counter-ink"
            on:click={() => openCustomize(line)}
          >
            Customize
          </button>
        </div>
        <div class="flex items-center gap-1.5">
          <button
            class="flex h-11 w-11 items-center justify-center rounded-lg bg-counter-paper text-xl font-extrabold text-counter-ink"
            on:click={() => dispatch('dec', line.menu_item_id)}
          >
            −
          </button>
          <div class="w-6 text-center font-mono text-[17px] font-extrabold text-counter-ink">{line.quantity}</div>
          <button
            class="flex h-11 w-11 items-center justify-center rounded-lg bg-counter-paper text-xl font-extrabold text-counter-ink"
            on:click={() => dispatch('inc', line.menu_item_id)}
          >
            +
          </button>
        </div>
        <div class="w-[58px] text-right font-mono text-base font-bold text-counter-ink">
          ${(line.unit_price * line.quantity).toFixed(2)}
        </div>
      </div>
    {/each}
  </div>

  <div class="flex-none border-t border-[#eee6d8] px-5 py-4">
    <div class="mb-1.5 flex justify-between text-sm text-counter-muted-2">
      <span>Subtotal</span><span class="font-mono">${totals.subtotal.toFixed(2)}</span>
    </div>
    <div class="mb-2.5 flex justify-between text-sm text-counter-muted-2">
      <span>Tax ({($settings.tax_rate * 100).toFixed(2)}%)</span><span class="font-mono">${totals.tax.toFixed(2)}</span>
    </div>
    <div class="mb-3.5 flex justify-between text-xl font-extrabold text-counter-ink">
      <span>Total</span><span class="font-mono">${totals.total.toFixed(2)}</span>
    </div>
    <Button
      variant="primary"
      size="lg"
      fullWidth
      disabled={cart.length === 0 || sent || sending}
      on:click={() => dispatch('send')}
    >
      {sending ? 'Sending…' : sent ? 'Sent to Kitchen ✓' : `Send to Kitchen (${itemCount}) →`}
    </Button>
  </div>
</div>

{#if customizeFor}
  <div
    class="fixed inset-0 z-30 flex items-end justify-center bg-black/40 sm:items-center"
    role="button"
    tabindex="0"
    aria-label="Close customize sheet"
    on:click|self={() => (customizeFor = null)}
    on:keydown={(e) => e.key === 'Escape' && (customizeFor = null)}
  >
    <div class="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl bg-white p-5 sm:w-[420px] sm:rounded-2xl">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">{customizeFor.name}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (customizeFor = null)}>Close</button>
      </div>

      {#if customizeFor.options?.length}
        <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Quick customizations</div>
        <div class="mb-4 flex flex-wrap gap-2">
          {#each customizeFor.options as option (option.id)}
            <button
              class="h-11 rounded-full border-2 px-4 text-sm font-bold {selectedLabels.has(option.label)
                ? 'border-counter-orange bg-counter-orange text-white'
                : 'border-counter-line bg-white text-counter-ink'}"
              on:click={() => toggleOption(option.label)}
            >
              {option.label}
            </button>
          {/each}
        </div>
      {/if}

      <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">Note for the kitchen</div>
      <textarea
        class="mb-4 h-24 w-full rounded-lg border border-counter-line bg-counter-paper p-3 text-[15px] text-counter-ink"
        bind:value={freeText}
        placeholder="Anything else the kitchen should know"
      ></textarea>

      <Button variant="primary" size="lg" fullWidth on:click={saveCustomize}>Done</Button>
    </div>
  </div>
{/if}
