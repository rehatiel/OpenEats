<script lang="ts">
  export let variant: 'primary' | 'secondary' | 'success' = 'primary';
  export let size: 'md' | 'lg' = 'md';
  export let fullWidth = false;

  const base =
    'inline-flex items-center justify-center gap-2 rounded-xl font-extrabold transition-transform active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100';

  const variants = {
    primary: 'bg-counter-orange text-white shadow-[0_3px_0_#B23C14]',
    secondary: 'bg-white border-[1.5px] border-counter-dashed text-counter-ink font-bold',
    success: 'bg-counter-paid text-white shadow-[0_3px_0_#0F5D3F]',
  };

  const sizes = {
    md: 'h-12 px-5 text-[15px]',
    lg: 'h-16 px-6 text-lg',
  };
</script>

<button
  class="{base} {variants[variant]} {sizes[size]} {fullWidth ? 'w-full' : ''}"
  on:click
  {...$$restProps}
>
  <slot />
</button>
