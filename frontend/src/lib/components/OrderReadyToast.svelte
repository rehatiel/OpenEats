<script lang="ts">
  // Mounted once in the root layout so a ready ticket surfaces no matter
  // which staff page is open — deliberately styled as a blocking modal
  // (dimmed backdrop, centered) rather than a corner toast, per request:
  // a food-ready alert should be hard to miss, not easy to work around.
  import { readyAlerts, dismissAlert, type ReadyAlert } from '$lib/stores/orderAlerts';

  function label(alert: ReadyAlert): string {
    if (alert.tableIdentifier) return alert.tableIdentifier;
    if (alert.customerName) return alert.customerName;
    return alert.type === 'to_go' ? 'To-Go order' : 'Delivery order';
  }

  function stationLabel(alert: ReadyAlert): string {
    return alert.stations.map((s) => (s === 'kitchen' ? 'Kitchen' : 'Bar')).join(' + ');
  }
</script>

{#if $readyAlerts.length}
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
    <div class="flex w-full max-w-lg flex-col gap-4 p-4">
      {#each $readyAlerts as alert (alert.orderId)}
        <div class="flex items-center gap-5 rounded-3xl border-2 border-blue-300 bg-blue-600 p-6 shadow-2xl">
          <div class="h-4 w-4 flex-shrink-0 rounded-full bg-white shadow-[0_0_16px_4px_rgba(255,255,255,0.8)]" />
          <div class="flex-1">
            <div class="text-3xl font-extrabold leading-tight text-white">{label(alert)}</div>
            <div class="mt-1 text-base font-bold text-blue-100">{stationLabel(alert)} · READY</div>
          </div>
          <button
            class="flex-shrink-0 rounded-xl border-2 border-white/70 bg-white px-5 py-3 text-base font-extrabold text-blue-700 hover:bg-blue-50"
            on:click={() => dismissAlert(alert)}
          >
            Dismiss
          </button>
        </div>
      {/each}
    </div>
  </div>
{/if}
