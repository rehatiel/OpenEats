<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MockTable } from '$lib/mockData';

  export let table: MockTable;
  export let selected = false;
  // Optional data-driven size override (used by the admin layout editor and
  // the real-layout floor plan). Omit to keep the original fixed-by-shape
  // sizing so every existing call site renders identically.
  export let width: number | undefined = undefined;
  export let height: number | undefined = undefined;

  $: tileWidth = width ?? (table.shape === 'round' ? 150 : 112);
  $: tileHeight = height ?? (table.shape === 'round' ? 150 : 112);

  const dispatch = createEventDispatcher<{ select: MockTable }>();

  const statusFill: Record<string, string> = {
    open: 'bg-white border-2 border-dashed border-counter-dashed',
    ordered: 'bg-counter-delivery shadow-[0_6px_16px_rgba(124,58,237,0.3)]',
    cooking: 'bg-counter-dinein shadow-[0_6px_16px_rgba(37,99,235,0.3)]',
    needs_bill: 'bg-counter-orange shadow-[0_6px_16px_rgba(239,90,38,0.3)]',
    ready: 'bg-counter-paid shadow-[0_6px_16px_rgba(23,132,90,0.3)]',
  };

  const numberColor: Record<string, string> = {
    open: 'text-[#C3B9A5]',
    ordered: 'text-white',
    cooking: 'text-white',
    needs_bill: 'text-white',
    ready: 'text-white',
  };

  const captionColor: Record<string, string> = {
    open: 'text-counter-faint',
    ordered: 'text-[#E6D9FF]',
    cooking: 'text-[#BCD0FF]',
    needs_bill: 'text-[#FFD9C9]',
    ready: 'text-[#B8E6D1]',
  };

  const statusLabel: Record<string, string> = {
    ordered: 'ORDERED',
    cooking: 'COOKING',
  };
</script>

{#if table.orderable === false}
  <button
    class="flex flex-col items-center justify-center rounded bg-counter-ink px-2 {selected ? 'ring-[3px] ring-counter-ink ring-offset-2' : ''}"
    style="width: {tileWidth}px; height: {tileHeight}px;"
    on:click={() => dispatch('select', table)}
  >
    <div class="text-center font-mono text-[11px] font-bold tracking-[0.15em] text-[#E8DFCE]">
      ◤ {table.id.toUpperCase()} ◢
    </div>
  </button>
{:else}
  <button
    class="flex flex-col items-center justify-center {table.shape === 'round' ? 'rounded-full' : 'rounded-2xl'} {statusFill[
      table.status
    ]} {selected ? 'ring-[3px] ring-counter-ink' : ''}"
    style="width: {tileWidth}px; height: {tileHeight}px;"
    on:click={() => dispatch('select', table)}
  >
    <div class="text-3xl font-extrabold leading-none {numberColor[table.status]}">{table.id}</div>

    {#if table.status === 'open'}
      <div class="mt-1 font-mono text-[11px] {captionColor[table.status]}">{table.seats} seats</div>
      <div class="mt-0.5 font-mono text-[10px] font-bold {captionColor[table.status]}">OPEN</div>
    {:else if table.status === 'ready'}
      <div class="mt-1 font-mono text-[11px] {captionColor[table.status]}">{table.seats} · {table.minutesOpen} min</div>
      <div class="mt-0.5 font-mono text-[10px] font-extrabold text-white">READY ●</div>
    {:else if table.status === 'ordered' || table.status === 'cooking'}
      <div class="mt-1 font-mono text-[11px] {captionColor[table.status]}">{table.seats} · {table.minutesOpen} min</div>
      <div class="mt-0.5 font-mono text-[10px] font-extrabold text-white">{statusLabel[table.status]}</div>
    {:else}
      <div class="mt-1 font-mono text-[11px] {captionColor[table.status]}">{table.seats} · {table.minutesOpen} min</div>
      <div class="mt-0.5 font-mono text-[13px] font-extrabold text-white">${table.total?.toFixed(2)}</div>
    {/if}
  </button>
{/if}
