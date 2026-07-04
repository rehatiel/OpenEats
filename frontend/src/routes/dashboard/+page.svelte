<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { apiJson } from '$lib/api';
  import { auth } from '$lib/stores/auth';
  import { settings } from '$lib/stores/settings';
  import KpiCard from '$lib/components/KpiCard.svelte';
  import TopBarNav from '$lib/components/TopBarNav.svelte';

  let range: 'today' | 'week' | 'month' = 'week';
  const ranges: { key: typeof range; label: string }[] = [
    { key: 'today', label: 'Today' },
    { key: 'week', label: 'This week' },
    { key: 'month', label: 'Month' },
  ];

  const fmt = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
  const fmtPct = (n: number) => `${n.toFixed(1)}%`;

  interface DashboardResponse {
    range: { key: string; start: string; end: string };
    kpis: {
      grossSales: number;
      grossSalesDeltaPct: number | null;
      foodCost: number;
      foodCostPct: number;
      grossProfit: number;
      grossProfitMarginPct: number;
      orders: number;
      avgTicket: number;
    };
    week: { date: string; label: string; sales: number; foodCost: number }[];
    marginTable: { id: number; name: string; price: number; foodCost: number; sold: number; marginPct: number }[];
    tipsByServer: { server: string; cashTips: number; cardTips: number; totalTips: number }[];
  }

  let dashboard: DashboardResponse | null = null;
  let dashboardLoaded = false;
  let dashboardError = '';

  // Bar heights are normalized client-side against the range's own peak day
  // — the API returns raw sales/food-cost numbers, not pre-scaled
  // percentages, since that's a presentation concern.
  $: weekPeak = Math.max(1, ...(dashboard?.week ?? []).flatMap((d) => [d.sales, d.foodCost]));
  $: weekBars = (dashboard?.week ?? []).map((d) => ({
    label: d.label,
    salesPct: (d.sales / weekPeak) * 100,
    foodCostPct: (d.foodCost / weekPeak) * 100,
  }));

  $: navLinks = [
    { href: '/', label: 'Order' },
    ...($settings.service_dine_in ? [{ href: '/register', label: 'Register' }] : []),
    ...($settings.bar_enabled ? [{ href: '/bar', label: 'Bar ↗' }] : []),
    ...($auth.user?.role === 'admin' ? [{ href: '/admin/users', label: 'Admin' }] : []),
  ];

  $: dateRangeLabel = dashboard
    ? `${new Date(dashboard.range.start).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date(
        dashboard.range.end
      ).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
    : '';

  async function loadDashboard() {
    dashboardError = '';
    try {
      dashboard = await apiJson<DashboardResponse>(`/api/reports/dashboard?range=${range}`);
    } catch (e) {
      dashboardError = e instanceof Error ? e.message : 'Failed to load dashboard';
    } finally {
      dashboardLoaded = true;
    }
  }

  $: range, loadDashboard();

  interface IngredientRow {
    id: number;
    name: string;
    unit: string;
    current_stock: number;
    reorder_threshold: number;
  }
  let ingredients: IngredientRow[] = [];
  let ingredientsLoaded = false;

  $: lowStock = ingredients
    .filter((i) => i.current_stock <= i.reorder_threshold)
    .map((i) => ({
      name: i.name,
      remaining: `${i.current_stock} ${i.unit} left`,
      fillPct: i.reorder_threshold > 0 ? Math.max(4, Math.min(100, (i.current_stock / i.reorder_threshold) * 100)) : 0,
      level: (i.current_stock <= i.reorder_threshold / 2 ? 'red' : 'amber') as 'red' | 'amber',
    }))
    .sort((a, b) => a.fillPct - b.fillPct);

  onMount(async () => {
    try {
      ingredients = await apiJson<IngredientRow[]>('/api/ingredients');
    } catch {
      // Card falls back to its empty state below.
    } finally {
      ingredientsLoaded = true;
    }
  });
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
    <div class="hidden font-mono text-sm text-counter-muted sm:block">{dateRangeLabel}</div>
    <TopBarNav links={navLinks} />
  </div>

  <div class="flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
    {#if dashboardError}
      <div class="rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{dashboardError}</div>
    {/if}

    <!-- KPI row -->
    <div class="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <KpiCard
        label="Gross sales"
        value={fmt(dashboard?.kpis.grossSales ?? 0)}
        sub={dashboard?.kpis.grossSalesDeltaPct != null
          ? `${dashboard.kpis.grossSalesDeltaPct >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(dashboard.kpis.grossSalesDeltaPct))} vs last period`
          : 'No prior-period data'}
        subColor="text-counter-paid"
      />
      <KpiCard label="Food cost" value={fmt(dashboard?.kpis.foodCost ?? 0)} sub={`${fmtPct(dashboard?.kpis.foodCostPct ?? 0)} of sales`} subColor="text-[#C2410C]" />
      <KpiCard
        label="Gross profit"
        value={fmt(dashboard?.kpis.grossProfit ?? 0)}
        sub={`${fmtPct(dashboard?.kpis.grossProfitMarginPct ?? 0)} margin`}
        inverted
      />
      <KpiCard
        label="Orders"
        value={(dashboard?.kpis.orders ?? 0).toLocaleString()}
        sub={`$${(dashboard?.kpis.avgTicket ?? 0).toFixed(2)} avg ticket`}
      />
    </div>

    <!-- middle row -->
    <div class="grid grid-cols-1 gap-4 xl:grid-cols-[1.7fr_1fr]">
      <!-- bar chart -->
      <div class="rounded-2xl border border-counter-line bg-white p-5">
        <div class="mb-4 flex items-center justify-between">
          <div class="text-[15px] font-bold text-counter-ink">Sales vs. food cost (last 7 days)</div>
          <div class="flex items-center gap-4 text-xs font-semibold text-counter-muted-2">
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-counter-ink"></span>Sales</span>
            <span class="flex items-center gap-1.5"><span class="h-2.5 w-2.5 rounded-sm bg-counter-orange"></span>Food cost</span>
          </div>
        </div>
        <div class="flex h-40 items-end justify-between gap-3">
          {#each weekBars as day, i (i)}
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
          <span class="rounded-full bg-counter-paper px-2.5 py-0.5 text-xs font-bold text-counter-muted-2">{lowStock.length} items</span>
        </div>
        {#if ingredientsLoaded && ingredients.length === 0}
          <div class="py-4 text-sm text-counter-muted">
            No ingredients tracked yet — add them in Admin → Inventory to see low-stock alerts here.
          </div>
        {:else if lowStock.length === 0}
          <div class="py-4 text-sm text-counter-muted">Everything's above its reorder threshold.</div>
        {:else}
          <div class="space-y-3.5">
            {#each lowStock as item}
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
                <div class="font-mono text-xs text-counter-muted">{item.remaining}</div>
              </div>
            {/each}
          </div>
        {/if}
        {#if $auth.user?.role === 'admin'}
          <button
            class="mt-4 h-12 w-full rounded-lg bg-counter-paper text-sm font-bold text-counter-ink disabled:cursor-not-allowed disabled:opacity-50"
            disabled={lowStock.length === 0}
            on:click={() => goto('/admin/purchase-orders?restock=1')}
          >
            Build restock list →
          </button>
        {/if}
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
      {#if dashboardLoaded && (dashboard?.marginTable ?? []).length === 0}
        <div class="py-4 text-sm text-counter-muted">No sales in this period yet.</div>
      {/if}
      {#each dashboard?.marginTable ?? [] as row (row.id)}
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
              {row.marginPct.toFixed(0)}%
            </span>
          </div>
        </div>
      {/each}
    </div>

    {#if $settings.accept_tips}
      <!-- tips by server -->
      <div class="rounded-2xl border border-counter-line bg-white p-5">
        <div class="mb-4 text-[15px] font-bold text-counter-ink">Tips by server &amp; payment method</div>
        <div class="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper pb-3 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Server</div>
          <div>Cash</div>
          <div>Card</div>
          <div>Total</div>
        </div>
        {#if dashboardLoaded && (dashboard?.tipsByServer ?? []).length === 0}
          <div class="py-4 text-sm text-counter-muted">No tips recorded in this period yet.</div>
        {/if}
        {#each dashboard?.tipsByServer ?? [] as row (row.server)}
          <div class="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper py-3 text-[15px]">
            <div class="font-semibold text-counter-ink">{row.server}</div>
            <div class="font-mono text-counter-muted-2">${row.cashTips.toFixed(2)}</div>
            <div class="font-mono text-counter-muted-2">${row.cardTips.toFixed(2)}</div>
            <div class="font-mono font-extrabold text-counter-ink">${row.totalTips.toFixed(2)}</div>
          </div>
        {/each}
      </div>
    {/if}
  </div>
</div>
