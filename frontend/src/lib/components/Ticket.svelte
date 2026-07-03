<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MockTicket } from '$lib/mockData';
  import TypeBadge from './TypeBadge.svelte';

  export let ticket: MockTicket;

  const dispatch = createEventDispatcher<{ advance: string }>();

  $: topBorder =
    ticket.type === 'dine_in' ? 'border-t-kds-dinein' : ticket.type === 'to_go' ? 'border-t-kds-togo' : 'border-t-kds-delivery';

  $: ring =
    ticket.status === 'cooking'
      ? 'shadow-[0_0_0_2px_#F5A524]'
      : ticket.status === 'late'
        ? 'shadow-[0_0_0_2px_#EF4444]'
        : '';

  $: timerColor =
    ticket.status === 'late' ? 'text-kds-late' : ticket.status === 'ready' ? 'text-kds-ready' : 'text-kds-cooking';

  $: footer =
    ticket.status === 'new'
      ? { label: 'Start Cooking', class: 'bg-kds-dinein text-white' }
      : ticket.status === 'cooking' || ticket.status === 'late'
        ? { label: 'Mark Ready ✓', class: 'bg-kds-ready text-[#062F18]' }
        : { label: 'Clear / Handed Off', class: 'bg-kds-card-2 text-kds-muted border-t border-kds-border' };
</script>

<div
  class="w-[270px] flex-none overflow-hidden rounded-xl border-t-[7px] {topBorder} {ring} {ticket.status === 'ready'
    ? 'bg-kds-done-bg'
    : 'bg-kds-card'}"
>
  <div class="border-b border-kds-border p-3">
    <div class="flex items-center justify-between">
      <span class="font-mono text-xl font-extrabold text-kds-text">#{ticket.orderId}</span>
      {#if ticket.status === 'ready'}
        <span class="font-mono text-xl font-extrabold text-kds-ready">✓ DONE</span>
      {:else}
        <span class="font-mono text-xl font-extrabold {timerColor}">{ticket.elapsed}</span>
      {/if}
    </div>
    <div class="mt-1.5 flex items-center gap-2">
      <TypeBadge
        type={ticket.type}
        theme="kds"
        label={ticket.table
          ? `${ticket.type === 'dine_in' ? 'Dine In' : ticket.type} · T${ticket.table}`
          : ticket.customerName
            ? `${ticket.type === 'to_go' ? 'To Go' : 'Delivery'} · ${ticket.customerName}`
            : undefined}
      />
      {#if ticket.status === 'ready'}
        <span class="font-mono text-xs text-kds-ready">READY</span>
      {:else if ticket.status === 'late'}
        <span class="font-mono text-xs font-bold text-kds-late">● LATE</span>
      {:else if ticket.server}
        <span class="font-mono text-xs text-kds-muted">{ticket.server}</span>
      {/if}
    </div>
  </div>

  <div class="p-3 {ticket.status === 'ready' ? 'opacity-75' : ''}">
    {#each ticket.lines as line}
      <div class="mb-1.5 flex items-baseline gap-2">
        <span class="font-mono text-xl font-extrabold {ticket.status === 'ready' ? 'text-kds-ready' : 'text-kds-cooking'}">{line.quantity}×</span>
        <span
          class="text-[19px] font-bold {ticket.status === 'ready'
            ? 'text-kds-strike line-through'
            : 'text-kds-text'}">{line.name}</span
        >
      </div>
      {#if line.note}
        <div class="ml-[46px] font-mono text-sm text-kds-togo">{line.note}</div>
      {/if}
    {/each}

    {#if ticket.drinks?.length}
      <div class="my-2 border-t border-kds-border pt-2">
        <div class="mb-1.5 text-[11px] font-bold uppercase tracking-[0.1em] text-kds-muted-2">Drinks</div>
        {#each ticket.drinks as line}
          <div class="flex items-baseline gap-2">
            <span class="font-mono text-xl font-extrabold text-kds-cooking">{line.quantity}×</span>
            <span class="text-[19px] font-bold text-kds-text">{line.name}</span>
          </div>
        {/each}
      </div>
    {/if}
  </div>

  <button
    class="h-[70px] w-full text-lg font-black {footer.class}"
    on:click={() => dispatch('advance', ticket.orderId)}
  >
    {footer.label}
  </button>
</div>
