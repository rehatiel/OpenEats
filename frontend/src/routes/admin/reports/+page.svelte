<script lang="ts">
  import { REPORTS } from '$lib/reports';
  import type { Cadence } from '$lib/reports';

  const cadences: { key: Cadence; label: string }[] = [
    { key: 'daily', label: 'Daily' },
    { key: 'weekly', label: 'Weekly' },
    { key: 'monthly', label: 'Monthly' },
    { key: 'yearly', label: 'Yearly' },
  ];

  $: grouped = cadences.map((c) => ({ ...c, reports: REPORTS.filter((r) => r.cadence === c.key) }));
</script>

<svelte:head>
  <title>Reports · Admin · OpenEats</title>
</svelte:head>

<div class="p-6">
  <div class="mb-5 text-xl font-extrabold text-counter-ink">Reports</div>

  {#each grouped as group (group.key)}
    <div class="mb-6">
      <div class="mb-2 text-xs font-bold uppercase tracking-wide text-counter-muted">{group.label}</div>
      <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each group.reports as report (report.slug)}
          <a
            href={`/admin/reports/${report.slug}`}
            class="rounded-2xl border border-counter-line bg-white p-4 hover:border-counter-orange"
          >
            <div class="mb-1 text-[15px] font-bold text-counter-ink">{report.title}</div>
            <div class="text-sm text-counter-muted">{report.description}</div>
          </a>
        {/each}
      </div>
    </div>
  {/each}
</div>
