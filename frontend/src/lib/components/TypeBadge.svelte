<script lang="ts">
  import type { OrderType } from '$lib/mockData';

  export let type: OrderType;
  export let theme: 'counter' | 'kds' = 'counter';
  export let label: string | null = null;

  const labels: Record<OrderType, string> = {
    dine_in: 'Dine In',
    to_go: 'To Go',
    delivery: 'Delivery',
  };

  // To Go uses the brand orange in the counter theme, so it needs dark text
  // to stay readable; every other combination is a solid color + white text.
  const classes: Record<'counter' | 'kds', Record<OrderType, string>> = {
    counter: {
      dine_in: 'bg-counter-dinein text-white',
      to_go: 'bg-counter-orange text-white',
      delivery: 'bg-counter-delivery text-white',
    },
    kds: {
      dine_in: 'bg-kds-dinein text-white',
      to_go: 'bg-kds-togo text-[#1A1206]',
      delivery: 'bg-kds-delivery text-white',
    },
  };
</script>

<span class="inline-flex rounded-md px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide {classes[theme][type]}">
  {label ?? labels[type]}
</span>
