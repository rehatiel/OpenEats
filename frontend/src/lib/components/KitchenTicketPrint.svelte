<script lang="ts">
  import type { MockTicket } from '$lib/mockData';

  export let restaurantName: string;
  export let stationLabel: 'KITCHEN' | 'BAR';
  export let ticket: MockTicket | null;
</script>

<!--
  Invisible in normal page flow — only ever shown by the print stylesheet in
  app.css (`@media print`), which hides everything else on the page and
  reveals just this element, isolated to its own printed page. Mirrors
  Receipt.svelte's approach exactly, with a different element id so the two
  never conflict on a page that somehow has both.
-->
{#if ticket}
  <div id="kitchen-ticket-print" class="mx-auto w-[302px] bg-white p-4 font-mono text-black">
    <div class="text-center text-base font-extrabold">{restaurantName}</div>
    <div class="text-center text-sm font-extrabold">{stationLabel}</div>
    <div class="mt-1 text-center text-sm">
      {ticket.table ?? ticket.customerName ?? (ticket.type === 'to_go' ? 'To-Go' : 'Delivery')}
    </div>
    {#if ticket.server}
      <div class="text-center text-xs">Server: {ticket.server}</div>
    {/if}
    <div class="text-center text-xs">{new Date().toLocaleString()}</div>

    <div class="my-2 border-t border-dashed border-black"></div>

    {#each ticket.lines as line}
      <div class="text-lg font-extrabold leading-tight">{line.quantity}x {line.name}</div>
      {#if line.note}
        <div class="pl-3 text-sm">- {line.note}</div>
      {/if}
    {/each}

    <div class="my-2 border-t border-dashed border-black"></div>
    <div class="text-center text-xs">Order #{ticket.orderId}</div>
  </div>
{/if}
