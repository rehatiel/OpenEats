<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface VendorRow {
    id: number;
    name: string;
    contact_name: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  }

  let vendors: VendorRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let editing: VendorRow | null = null;
  let formName = '';
  let formContact = '';
  let formPhone = '';
  let formEmail = '';
  let formNotes = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      vendors = await apiJson<VendorRow[]>('/api/vendors');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load vendors';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    editing = null;
    formName = '';
    formContact = '';
    formPhone = '';
    formEmail = '';
    formNotes = '';
    formError = '';
    formOpen = true;
  }

  function openEdit(v: VendorRow) {
    editing = v;
    formName = v.name;
    formContact = v.contact_name ?? '';
    formPhone = v.phone ?? '';
    formEmail = v.email ?? '';
    formNotes = v.notes ?? '';
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    if (!formName.trim()) {
      formError = 'Name is required';
      return;
    }
    saving = true;
    try {
      const body = {
        name: formName.trim(),
        contact_name: formContact.trim() || null,
        phone: formPhone.trim() || null,
        email: formEmail.trim() || null,
        notes: formNotes.trim() || null,
      };
      if (editing) {
        await apiJson(`/api/vendors/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiJson('/api/vendors', { method: 'POST', body: JSON.stringify(body) });
      }
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function removeVendor(v: VendorRow) {
    loadError = '';
    try {
      await apiJson(`/api/vendors/${v.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Delete failed';
    }
  }
</script>

<svelte:head>
  <title>Vendors · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Vendors</div>
      <Button variant="primary" on:click={openAdd}>+ Add vendor</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        {#each vendors as v (v.id)}
          <div class="grid grid-cols-[2fr_1.5fr_1.5fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{v.name}</div>
            <div class="text-counter-muted-2">{v.contact_name ?? '—'}</div>
            <div class="font-mono text-sm text-counter-muted-2">{v.phone ?? v.email ?? '—'}</div>
            <div class="flex justify-end gap-2 text-sm font-bold">
              <button class="text-counter-muted-2 hover:text-counter-ink" on:click={() => openEdit(v)}>Edit</button>
              <button class="text-counter-muted-2 hover:text-counter-orange-dark" on:click={() => removeVendor(v)}>Remove</button>
            </div>
          </div>
        {/each}
        {#if vendors.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No vendors yet — add the first one.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">{editing ? 'Edit vendor' : 'Add vendor'}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="vendor-name" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Name</label>
      <input
        id="vendor-name"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formName}
        placeholder="Vendor name"
      />

      <label for="vendor-contact" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Contact name</label>
      <input
        id="vendor-contact"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formContact}
      />

      <label for="vendor-phone" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Phone</label>
      <input
        id="vendor-phone"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formPhone}
      />

      <label for="vendor-email" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Email</label>
      <input
        id="vendor-email"
        type="email"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formEmail}
      />

      <label for="vendor-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
      <textarea
        id="vendor-notes"
        class="mb-4 min-h-[80px] rounded-lg border border-counter-line bg-counter-paper px-3 py-2 text-[15px] text-counter-ink"
        bind:value={formNotes}
      ></textarea>

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
