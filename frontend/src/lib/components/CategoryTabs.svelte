<script lang="ts">
  import { createEventDispatcher } from 'svelte';

  export let items: readonly string[];
  export let active: string;

  const dispatch = createEventDispatcher<{ select: string }>();
</script>

<div class="flex flex-wrap gap-2">
  {#each items as item}
    <button
      class="rounded-lg px-4 py-2.5 text-sm font-bold transition-colors {item === active
        ? 'bg-counter-ink text-white'
        : 'border border-counter-line bg-white text-counter-muted-2'}"
      on:click={() => dispatch('select', item)}
    >
      {item}
    </button>
  {/each}
</div>
