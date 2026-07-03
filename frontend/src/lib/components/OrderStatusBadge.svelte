<script lang="ts">
  export let status: 'open' | 'cooking' | 'ready' | 'needs_bill' | 'occupied';

  const styles: Record<string, string> = {
    open: 'bg-[#FEF0E9] text-[#C2410C] border-[#F6C9B3]',
    cooking: 'bg-[#FFF7E6] text-[#A16207] border-[#F0D99B]',
    ready: 'bg-[#E7F7EE] text-[#0F7A4F] border-[#A7E0C1]',
    needs_bill: 'bg-counter-orange text-white border-transparent',
    occupied: 'bg-counter-dinein text-white border-transparent',
  };

  const labels: Record<string, string> = {
    open: 'Open',
    cooking: 'Cooking',
    ready: 'Ready',
    needs_bill: 'Needs Bill',
    occupied: 'Occupied',
  };
</script>

<span class="inline-flex rounded-md border px-2.5 py-1.5 text-xs font-extrabold uppercase tracking-wide {styles[status]}">
  {labels[status]}
</span>
