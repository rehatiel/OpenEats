<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { MockMenuItem } from '$lib/mockData';

  export let item: MockMenuItem;
  export let quantityInCart = 0;

  const dispatch = createEventDispatcher<{ add: MockMenuItem }>();
</script>

<button
  class="overflow-hidden rounded-xl border bg-white text-left transition-transform transition-shadow active:scale-[0.98] {quantityInCart > 0
    ? 'border-[1.5px] border-counter-orange shadow-[0_4px_14px_rgba(239,90,38,0.14)]'
    : 'border-counter-line'}"
  on:click={() => dispatch('add', item)}
>
  <div
    class="relative h-20 sm:h-24"
    style={item.image_url
      ? undefined
      : 'background-image: repeating-linear-gradient(45deg, #f0ece3, #f0ece3 8px, #e9e3d6 8px, #e9e3d6 16px);'}
  >
    {#if item.image_url}
      <img src={item.image_url} alt={item.name} class="h-full w-full object-cover" />
    {/if}
    {#if quantityInCart > 0}
      <div
        class="absolute right-2 top-2 flex h-[26px] w-[26px] items-center justify-center rounded-lg bg-counter-orange text-sm font-extrabold text-white"
      >
        {quantityInCart}
      </div>
    {/if}
  </div>
  <div class="p-3">
    <div class="text-[15px] font-bold leading-tight text-counter-ink">{item.name}</div>
    <div class="mt-1 font-mono text-[15px] font-bold tabular-nums text-counter-orange">
      ${item.retail_price.toFixed(2)}
    </div>
  </div>
</button>
