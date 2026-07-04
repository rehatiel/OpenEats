<script lang="ts">
  import type { CombinedLine } from '$lib/orders';

  export let restaurantName: string;
  export let orderLabel: string;
  export let orderIds: string;
  export let lines: CombinedLine[];
  export let totals: { subtotal: number; tax: number; total: number };
  export let taxRate: number;
  export let timestamp: string;
  // false renders a pre-payment bill ("Amount Due") instead of a paid
  // receipt ("Thank you!") — used by Checkout's Print Bill action.
  export let settled = true;
  export let tipAmount = 0;
  export let cardFee = 0;
  export let paidMessage = 'Thank you!';
  export let billMessage = 'Please pay at the counter';
</script>

<!--
  Invisible in normal page flow — only ever shown by the print stylesheet in
  app.css (`@media print`), which hides everything else on the page and
  reveals just this element, isolated to its own printed page.
-->
<div id="receipt-print" class="mx-auto w-[302px] bg-white p-4 font-mono text-[13px] text-black">
  <div class="text-center text-base font-extrabold">{restaurantName}</div>
  <div class="mt-1 text-center text-xs">{orderLabel}{orderIds ? ` · ${orderIds}` : ''}</div>
  <div class="text-center text-xs">{new Date(timestamp).toLocaleString()}</div>

  <div class="my-2 border-t border-dashed border-black"></div>

  {#each lines as line}
    <div class="flex justify-between gap-2">
      <span>{line.quantity}x {line.name}</span>
      <span class="flex-none">${(line.unit_price * line.quantity).toFixed(2)}</span>
    </div>
    {#if line.note}
      <div class="pl-3 text-xs">- {line.note}</div>
    {/if}
  {/each}

  <div class="my-2 border-t border-dashed border-black"></div>

  <div class="flex justify-between"><span>Subtotal</span><span>${totals.subtotal.toFixed(2)}</span></div>
  <div class="flex justify-between"><span>Tax ({(taxRate * 100).toFixed(2)}%)</span><span>${totals.tax.toFixed(2)}</span></div>
  {#if cardFee > 0}
    <div class="flex justify-between"><span>Card processing fee</span><span>${cardFee.toFixed(2)}</span></div>
  {/if}
  {#if tipAmount > 0}
    <div class="flex justify-between"><span>Tip</span><span>${tipAmount.toFixed(2)}</span></div>
  {/if}
  <div class="mt-1 flex justify-between text-base font-extrabold">
    <span>{settled ? 'Total' : 'Amount Due'}</span><span>${(totals.total + cardFee + tipAmount).toFixed(2)}</span>
  </div>

  <div class="my-2 border-t border-dashed border-black"></div>

  <div class="text-center">{settled ? paidMessage : billMessage}</div>
</div>
