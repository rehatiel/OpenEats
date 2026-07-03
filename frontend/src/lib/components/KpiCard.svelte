<script lang="ts">
  export let label: string;
  export let value: string;
  export let sub: string;
  export let subColor = 'text-counter-muted';
  export let inverted = false;
</script>

<div
  class="rounded-2xl border p-5 {inverted
    ? 'border-transparent bg-counter-ink'
    : 'border-counter-line bg-white'}"
>
  <div class="text-[13px] font-semibold {inverted ? 'text-counter-faint' : 'text-counter-muted'}">{label}</div>
  <div class="mt-1 font-mono text-[32px] font-black tracking-tight {inverted ? 'text-white' : 'text-counter-ink'}">
    {value}
  </div>
  <div class="mt-1 text-xs font-bold {inverted ? 'text-[#7EE0B0]' : subColor}">{sub}</div>
</div>
