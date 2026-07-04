<script lang="ts">
  import { page } from '$app/stores';
  import { auth } from '$lib/stores/auth';

  const navItems = [
    { href: '/admin/users', label: 'Users' },
    { href: '/admin/menu', label: 'Menu' },
    { href: '/admin/tables', label: 'Tables' },
    { href: '/admin/inventory', label: 'Inventory' },
    { href: '/admin/vendors', label: 'Vendors' },
    { href: '/admin/purchase-orders', label: 'Purchase Orders' },
    { href: '/admin/vendor-invoices', label: 'Vendor Invoices' },
    { href: '/admin/inventory-counts', label: 'Inventory Counts' },
    { href: '/admin/capex', label: 'CapEx Log' },
    { href: '/admin/wage-rates', label: 'Wage Rates' },
    { href: '/admin/schedules', label: 'Schedules' },
    { href: '/admin/reports', label: 'Reports' },
    { href: '/admin/settings', label: 'Settings' },
  ];

  $: pathname = $page.url.pathname;
</script>

<div class="flex h-screen overflow-hidden bg-counter-paper">
  <!-- sidebar -->
  <div class="flex w-[220px] flex-none flex-col border-r border-counter-line bg-white">
    <div class="flex h-16 flex-none items-center gap-2.5 border-b border-counter-line px-5">
      <div class="flex h-9 w-9 items-center justify-center rounded-lg bg-counter-ink text-lg font-black text-white">
        A
      </div>
      <div class="text-[15px] font-extrabold text-counter-ink">Admin</div>
    </div>

    <nav class="flex-1 space-y-1 p-3">
      {#each navItems as item}
        <a
          href={item.href}
          class="block rounded-lg px-3.5 py-2.5 text-sm font-bold {pathname.startsWith(item.href)
            ? 'bg-counter-ink text-white'
            : 'text-counter-muted-2 hover:bg-counter-tabs'}"
        >
          {item.label}
        </a>
      {/each}
    </nav>

    <div class="border-t border-counter-line p-3">
      <div class="mb-2 px-3.5 font-mono text-xs text-counter-muted">
        {$auth.user?.name} · {$auth.user?.role}
      </div>
      <a href="/" class="block rounded-lg px-3.5 py-2.5 text-sm font-bold text-counter-muted-2 hover:bg-counter-tabs">
        Exit to POS ↗
      </a>
    </div>
  </div>

  <!-- content -->
  <div class="min-w-0 flex-1 overflow-y-auto">
    <slot />
  </div>
</div>
