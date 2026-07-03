<script lang="ts">
  import { goto } from '$app/navigation';
  import { DASHBOARD_KPIS, DASHBOARD_WEEK, LOW_STOCK, MARGIN_TABLE } from '$lib/mockData';
  import { auth, logout } from '$lib/stores/auth';
  import KpiCard from '$lib/components/KpiCard.svelte';

  let range: 'today' | 'week' | 'month' = 'week';
  const ranges: { key: typeof range; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'Month' },
  ];

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
</script>

<svelte:head>
  <title>Dashboard · OpenEats</title>
</svelte:head>

<div class="flex h-screen flex-col overflow-hidden">
  <!-- top bar -->
  <div class="flex h-16 flex-none items-center gap-4 border-b border-counter-line bg-white px-4 sm:px-5">
    <div class="text-lg font-extrabold text-counter-ink">Dashboard</div>
    <div class="flex-1"></div>
    <div class="flex gap-1.5 rounded-xl bg-counter-tabs p-1.5">
      {#each ranges as r (r.key)}
        <button
          class="rounded-lg px-3.5 py-2 text-sm font-bold {range === r.key ? 'bg-counter-ink text-white' : 'text-counter-muted-2'}"
          on:click={() => (range = r.key)}
        >
          {r.label}
        </button>
      {/each}
    </div>
    <div class="hidden font-mono text-sm text-counter-muted sm:block">Jun 26 – Jul 2</div>
    <a href="/" class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink">Order</a>
    {#if $auth.user?.role === 'admin'}
      <a href="/admin/users" class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink">Admin</a>
    {/if}
    <div class="hidden items-center gap-2 lg:flex">
      <div class="font-mono text-[13px] text-counter-muted">{$auth.user?.name} · {$auth.user?.role}</div>
      <button
        class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink"
        on:click={() => {
          logout();
          goto('/login');
        }}
      >
        Sign out
      </button>
    </div>
  </div>

  <div class="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
    <!-- KPI row -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard label="Gross sales" value={fmt(DASHBOARD_KPIS.grossSales)} sub={`▲ ${DASHBOARD_KPIS.grossSalesDelta}`} subColor="text-counter-paid" />
      <KpiCard label="Food cost" value={fmt(DASHBOARD_KPIS.foodCost)} sub={DASHBOARD_KPIS.foodCostPct} subColor="text-[#C2410C]" />
      <KpiCard label="Gross profit" value={fmt(DASHBOARD_KPIS.grossProfit)} sub={DASHBOARD_KPIS.grossProfitMargin} inverted />
      <KpiCard
        label="Orders"
        value={DASHBOARD_KPIS.orders.toLocaleString()}
        sub={`$${DASHBOARD_KPIS.avgTicket.toFixed(2)} avg ticket`}
      />
    </div>

    <!-- middle row -->
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
      <!-- bar chart -->
      <div class="rounded-2xl border border-counter-line bg-white p-5">
        <div class="mb-4 flex items-center justify-between">
          <div class="text-[15px] font-bold text-counter-ink">Sales vs. food cost</div>
          <div class="flex items-center gap-4 text-xs font-semibold text-counter-muted-2">
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-counter-ink"></span>Sales</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-counter-orange"></span>Food cost</span>
          </div>
        </div>
        <div class="flex h-40 items-end justify-between gap-3">
          {#each DASHBOARD_WEEK as day (day.label)}
            <div class="flex flex-1 flex-col items-center gap-1.5">
              <div class="flex h-32 w-full items-end justify-center gap-1">
                <div class="w-5 rounded-t bg-counter-ink" style="height: {day.salesPct}%"></div>
                <div class="w-5 rounded-t bg-counter-orange" style="height: {day.foodCostPct}%"></div>
              </div>
              <div class="font-mono text-[11px] text-counter-muted">{day.label}</div>
            </div>
          {/each}
        </div>
      </div>

      <!-- low stock -->
      <div class="rounded-2xl border border-counter-line bg-white p-5">
        <div class="mb-4 flex items-center gap-2.5">
          <div class="flex h-[22px] w-[22px] items-center justify-center rounded-md bg-[#FEF0E9] text-sm font-extrabold text-[#C2410C]">!</div>
          <div class="text-[15px] font-bold text-counter-ink">Low stock</div>
          <span class="rounded-full bg-counter-paper px-2.5 py-0.5 text-xs font-bold text-counter-muted-2">{LOW_STOCK.length} items</span>
        </div>
        <div class="space-y-3.5">
          {#each LOW_STOCK as item}
            <div>
              <div class="flex items-center justify-between">
                <div class="text-[15px] font-bold text-counter-ink">{item.name}</div>
                <div class="h-2 w-[60px] overflow-hidden rounded-full bg-counter-paper">
                  <div
                    class="h-full rounded-full {item.level === 'red' ? 'bg-counter-orange' : 'bg-[#D97706]'}"
                    style="width: {item.fillPct}%"
                  ></div>
                </div>
              </div>
              <div class="font-mono text-xs text-counter-muted">{item.remaining} · {item.runway}</div>
            </div>
          {/each}
        </div>
        <button class="mt-4 h-12 w-full rounded-lg bg-counter-paper text-sm font-bold text-counter-ink">
          Build restock list →
        </button>
      </div>
    </div>

    <!-- margin table -->
    <div class="rounded-2xl border border-counter-line bg-white p-5">
      <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1.4fr] gap-2 border-b border-counter-paper pb-3 text-xs font-bold uppercase tracking-wide text-counter-muted">
        <div>Item</div>
        <div>Price</div>
        <div>Food cost</div>
        <div>Sold</div>
        <div>Margin</div>
      </div>
      {#each MARGIN_TABLE as row}
        <div class="grid grid-cols-[2fr_1fr_1fr_1fr_1.4fr] items-center gap-2 border-b border-counter-paper py-3 text-[15px]">
          <div class="font-semibold text-counter-ink">{row.name}</div>
          <div class="font-mono text-counter-muted-2">${row.price.toFixed(2)}</div>
          <div class="font-mono text-counter-muted-2">${row.foodCost.toFixed(2)}</div>
          <div class="font-mono text-counter-muted-2">{row.sold}</div>
          <div class="flex items-center gap-2">
            <div class="h-[7px] w-[54px] overflow-hidden rounded-full {row.marginPct >= 60 ? 'bg-[#E7F7EE]' : 'bg-[#FFF7E6]'}">
              <div
                class="h-full rounded-full {row.marginPct >= 60 ? 'bg-counter-paid' : 'bg-[#D97706]'}"
                style="width: {row.marginPct}%"
              ></div>
            </div>
            <span class="font-mono text-sm font-extrabold {row.marginPct >= 60 ? 'text-counter-paid' : 'text-[#A16207]'}">
              {row.marginPct}%
            </span>
          </div>
        </div>
      {/each}
    </div>
  </div>
</div>
