<script lang="ts">
  import { page } from '$app/stores';
  import { apiJson } from '$lib/api';
  import { getReport, formatValue } from '$lib/reports';
  import ReportTable from '$lib/components/ReportTable.svelte';

  $: slug = $page.params.slug;
  $: entry = getReport(slug);

  let data: any = null;
  let loading = true;
  let loadError = '';
  let range = '';
  let date = new Date().toISOString().slice(0, 10);
  let loadedForSlug = '';

  // Reset the range to this report's default whenever the slug changes
  // (e.g. navigating from one report to another) — otherwise a report with
  // no 'today' option could inherit a stale range from the previous page.
  $: if (entry && loadedForSlug !== entry.slug) {
    range = entry.defaultRange ?? '';
    loadedForSlug = entry.slug;
  }

  async function load() {
    if (!entry) return;
    loading = true;
    loadError = '';
    try {
      const params = new URLSearchParams();
      if (entry.usesDateParam) params.set('date', date);
      else if (entry.rangeOptions) params.set('range', range);
      const qs = params.toString();
      data = await apiJson(qs ? `${entry.endpoint}?${qs}` : entry.endpoint);
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load report';
      data = null;
    } finally {
      loading = false;
    }
  }

  $: entry, range, date, load();

  $: rows = entry?.toRows && data ? entry.toRows(data) : [];
  $: note = entry?.note && data ? entry.note(data) : null;
</script>

<svelte:head>
  <title>{entry?.title ?? 'Report'} · Admin · OpenEats</title>
</svelte:head>

<div class="p-6">
  {#if !entry}
    <div class="text-sm text-counter-muted">Unknown report.</div>
  {:else}
    <div class="mb-1 text-xl font-extrabold text-counter-ink">{entry.title}</div>
    <div class="mb-5 text-sm text-counter-muted">{entry.description}</div>

    <div class="mb-5 flex items-center gap-3">
      {#if entry.usesDateParam}
        <input
          type="date"
          class="h-10 rounded-lg border border-counter-line bg-white px-3 text-sm text-counter-ink"
          bind:value={date}
        />
      {:else if entry.rangeOptions}
        <div class="flex gap-1.5 rounded-xl bg-counter-tabs p-1.5">
          {#each entry.rangeOptions as r (r)}
            <button
              class="rounded-lg px-3.5 py-2 text-sm font-bold {range === r ? 'bg-counter-ink text-white' : 'text-counter-muted-2'}"
              on:click={() => (range = r)}
            >
              {r}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else if data}
      {#if entry.summaryFields}
        <div class="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {#each entry.summaryFields as field (field.key)}
            <div class="rounded-2xl border border-counter-line bg-white p-4">
              <div class="text-xs font-bold uppercase tracking-wide text-counter-muted">{field.label}</div>
              <div class="mt-1 font-mono text-xl font-extrabold text-counter-ink">{formatValue(data[field.key], field.format)}</div>
            </div>
          {/each}
        </div>
      {/if}

      {#if entry.columns}
        <ReportTable columns={entry.columns} {rows} />
      {/if}

      {#if note}
        <div class="mt-4 text-xs text-counter-muted">{note}</div>
      {/if}
    {/if}
  {/if}
</div>
