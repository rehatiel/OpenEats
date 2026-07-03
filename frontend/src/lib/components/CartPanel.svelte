<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { CartLine, OrderType } from '$lib/mockData';
  import { settings } from '$lib/stores/settings';
  import TypeBadge from './TypeBadge.svelte';
  import Button from './Button.svelte';

  export let cart: CartLine[];
  export let orderType: OrderType;
  export let tableLabel: string | null = null;
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

  let editingNoteFor: number | null = null;
  let noteDraft = '';

  function startNote(line: CartLine) {
    editingNoteFor = line.menu_item_id;
    noteDraft = line.note ?? '';
  }

  function saveNote(id: number) {
    dispatch('note', { id, note: noteDraft.trim() || undefined });
    editingNoteFor = null;
  }

  function focus(el: HTMLElement) {
    el.focus();
  }
</script>

<div class="flex h-full flex-col">
  <div class="flex-none border-b border-[#eee6d8] px-5 py-4">
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="text-lg font-extrabold text-counter-ink">Order</div>
        {#if cart.length > 0}
          <button
            class="text-xs font-bold text-counter-muted-2 hover:text-counter-orange-dark"
            on:click={() => dispatch('clear')}
          >
            Clear
          </button>
        {/if}
      </div>
      <TypeBadge type={orderType} label={tableLabel ? `${orderType === 'dine_in' ? 'Dine In' : orderType} · ${tableLabel}` : undefined} />
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
          {#if editingNoteFor === line.menu_item_id}
            <input
              use:focus
              class="mt-1 h-8 w-full rounded border border-counter-orange bg-counter-paper px-2 font-mono text-xs text-counter-ink"
              bind:value={noteDraft}
              placeholder="Special instructions for the kitchen"
              on:blur={() => saveNote(line.menu_item_id)}
              on:keydown={(e) => e.key === 'Enter' && saveNote(line.menu_item_id)}
            />
          {:else}
            <div class="font-mono text-xs text-counter-muted">
              ${line.unit_price.toFixed(2)} ea{line.note ? ` · ${line.note}` : ''}
              <button
                class="ml-1 font-sans text-counter-orange-dark underline decoration-dotted"
                on:click={() => startNote(line)}
              >
                {line.note ? 'edit note' : '+ note'}
              </button>
            </div>
          {/if}
        </div>
        <div class="flex items-center gap-1.5">
          <button
            class="flex h-9 w-9 items-center justify-center rounded-lg bg-counter-paper text-xl font-extrabold text-counter-ink"
            on:click={() => dispatch('dec', line.menu_item_id)}
          >
            −
          </button>
          <div class="w-6 text-center font-mono text-[17px] font-extrabold text-counter-ink">{line.quantity}</div>
          <button
            class="flex h-9 w-9 items-center justify-center rounded-lg bg-counter-paper text-xl font-extrabold text-counter-ink"
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
