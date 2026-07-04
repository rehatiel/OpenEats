<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface VendorRow {
    id: number;
    name: string;
  }

  interface InvoiceRow {
    id: number;
    vendor_id: number;
    vendor_name: string;
    invoice_number: string | null;
    invoice_date: string;
    due_date: string;
    amount: number;
    paid_date: string | null;
    status: 'open' | 'paid';
    notes: string | null;
    is_overdue: boolean;
  }

  let invoices: InvoiceRow[] = [];
  let vendors: VendorRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let formVendorId: number | null = null;
  let formInvoiceNumber = '';
  let formInvoiceDate = '';
  let formDueDate = '';
  let formAmount = '';
  let formNotes = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      [invoices, vendors] = await Promise.all([
        apiJson<InvoiceRow[]>('/api/vendor-invoices'),
        apiJson<VendorRow[]>('/api/vendors'),
      ]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load vendor invoices';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    formVendorId = vendors[0]?.id ?? null;
    formInvoiceNumber = '';
    formInvoiceDate = new Date().toISOString().slice(0, 10);
    formDueDate = '';
    formAmount = '';
    formNotes = '';
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    const amount = Number(formAmount);
    if (!formVendorId) {
      formError = 'Vendor is required';
      return;
    }
    if (!formInvoiceDate || !formDueDate) {
      formError = 'Invoice date and due date are required';
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      formError = 'Amount must be a positive number';
      return;
    }
    saving = true;
    try {
      await apiJson('/api/vendor-invoices', {
        method: 'POST',
        body: JSON.stringify({
          vendor_id: formVendorId,
          invoice_number: formInvoiceNumber.trim() || null,
          invoice_date: formInvoiceDate,
          due_date: formDueDate,
          amount,
          notes: formNotes.trim() || null,
        }),
      });
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function markPaid(invoice: InvoiceRow) {
    loadError = '';
    try {
      await apiJson(`/api/vendor-invoices/${invoice.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'paid' }) });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to mark paid';
    }
  }
</script>

<svelte:head>
  <title>Vendor Invoices · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Vendor invoices</div>
      <Button variant="primary" on:click={openAdd}>+ Add invoice</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Vendor</div>
          <div>Invoice #</div>
          <div>Due</div>
          <div>Amount</div>
          <div>Status</div>
          <div></div>
        </div>
        {#each invoices as inv (inv.id)}
          <div class="grid grid-cols-[1.5fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{inv.vendor_name}</div>
            <div class="font-mono text-sm text-counter-muted-2">{inv.invoice_number ?? '—'}</div>
            <div class="font-mono text-sm {inv.is_overdue ? 'font-bold text-counter-orange-dark' : 'text-counter-muted-2'}">{inv.due_date}</div>
            <div class="font-mono text-counter-muted-2">${inv.amount.toFixed(2)}</div>
            <div>
              {#if inv.status === 'paid'}
                <span class="rounded-full bg-[#E7F7EE] px-2.5 py-0.5 text-xs font-bold text-counter-paid">Paid</span>
              {:else if inv.is_overdue}
                <span class="rounded-full bg-[#FEF0E9] px-2.5 py-0.5 text-xs font-bold text-counter-orange-dark">Overdue</span>
              {:else}
                <span class="rounded-full bg-counter-paper px-2.5 py-0.5 text-xs font-bold text-counter-muted-2">Open</span>
              {/if}
            </div>
            <div class="text-right">
              {#if inv.status === 'open'}
                <button class="text-sm font-bold text-counter-muted-2 hover:text-counter-ink" on:click={() => markPaid(inv)}>
                  Mark paid
                </button>
              {/if}
            </div>
          </div>
        {/each}
        {#if invoices.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No vendor invoices yet.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Add invoice</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      {#if vendors.length === 0}
        <div class="text-sm text-counter-muted">Add a vendor in Admin → Vendors first.</div>
      {:else}
        <label for="inv-vendor" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Vendor</label>
        <select
          id="inv-vendor"
          class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
          bind:value={formVendorId}
        >
          {#each vendors as v (v.id)}
            <option value={v.id}>{v.name}</option>
          {/each}
        </select>

        <label for="inv-number" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Invoice number</label>
        <input
          id="inv-number"
          class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
          bind:value={formInvoiceNumber}
        />

        <label for="inv-date" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Invoice date</label>
        <input
          id="inv-date"
          type="date"
          class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
          bind:value={formInvoiceDate}
        />

        <label for="inv-due" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Due date</label>
        <input
          id="inv-due"
          type="date"
          class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
          bind:value={formDueDate}
        />

        <label for="inv-amount" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Amount ($)</label>
        <input
          id="inv-amount"
          type="number"
          step="0.01"
          min="0"
          class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 font-mono text-[15px] text-counter-ink"
          bind:value={formAmount}
        />

        <label for="inv-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
        <textarea
          id="inv-notes"
          class="mb-4 min-h-[80px] rounded-lg border border-counter-line bg-counter-paper px-3 py-2 text-[15px] text-counter-ink"
          bind:value={formNotes}
        ></textarea>

        {#if formError}
          <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
        {/if}

        <Button variant="success" fullWidth on:click={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
      {/if}
    </div>
  {/if}
</div>
