<script lang="ts">
  import { formatValue } from '$lib/reports';
  import type { ReportColumn } from '$lib/reports';

  export let columns: ReportColumn[];
  export let rows: Record<string, unknown>[];
</script>

<div class="overflow-x-auto rounded-2xl border border-counter-line bg-white">
  <table class="w-full text-[15px]">
    <thead>
      <tr class="border-b border-counter-paper text-xs font-bold uppercase tracking-wide text-counter-muted">
        {#each columns as col (col.key)}
          <th class="whitespace-nowrap px-4 py-2.5 text-left">{col.label}</th>
        {/each}
      </tr>
    </thead>
    <tbody>
      {#each rows as row, i (i)}
        <tr class="border-b border-counter-paper last:border-b-0">
          {#each columns as col (col.key)}
            <td class="whitespace-nowrap px-4 py-2.5 {col.format === 'text' ? '' : 'font-mono'} text-counter-ink">
              {formatValue(row[col.key], col.format)}
            </td>
          {/each}
        </tr>
      {/each}
      {#if rows.length === 0}
        <tr>
          <td colspan={columns.length} class="px-4 py-8 text-center text-sm text-counter-muted">No data for this period.</td>
        </tr>
      {/if}
    </tbody>
  </table>
</div>
