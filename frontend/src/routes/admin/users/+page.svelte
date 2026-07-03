<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';
  import Keypad from '$lib/components/Keypad.svelte';

  interface UserRow {
    id: number;
    name: string;
    role: 'admin' | 'manager' | 'staff' | 'kitchen';
    active: number;
    created_at: string;
  }

  const PIN_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  const roleStyle: Record<string, string> = {
    admin: 'bg-counter-orange text-white',
    manager: 'bg-counter-dinein text-white',
    staff: 'bg-counter-tabs text-counter-muted-2',
    kitchen: 'bg-counter-delivery text-white',
  };

  let users: UserRow[] = [];
  let loading = true;
  let loadError = '';

  let formOpen = false;
  let editing: UserRow | null = null;
  let formName = '';
  let formRole: UserRow['role'] = 'staff';
  let formPin = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      users = await apiJson<UserRow[]>('/api/admin/users');
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load users';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    editing = null;
    formName = '';
    formRole = 'staff';
    formPin = '';
    formError = '';
    formOpen = true;
  }

  function openEdit(u: UserRow) {
    editing = u;
    formName = u.name;
    formRole = u.role;
    formPin = '';
    formError = '';
    formOpen = true;
  }

  function pressPin(k: string) {
    if (k === '⌫') {
      formPin = formPin.slice(0, -1);
      return;
    }
    if (formPin.length >= 6) return;
    formPin = formPin + k;
  }

  async function save() {
    formError = '';
    if (!formName.trim()) {
      formError = 'Name is required';
      return;
    }
    const pinRequired = !editing;
    if ((pinRequired || formPin) && !/^\d{4,6}$/.test(formPin)) {
      formError = 'PIN must be 4-6 digits';
      return;
    }

    saving = true;
    try {
      if (editing) {
        const body: Record<string, unknown> = { name: formName.trim(), role: formRole };
        if (formPin) body.pin = formPin;
        await apiJson(`/api/admin/users/${editing.id}`, { method: 'PUT', body: JSON.stringify(body) });
      } else {
        await apiJson('/api/admin/users', {
          method: 'POST',
          body: JSON.stringify({ name: formName.trim(), role: formRole, pin: formPin }),
        });
      }
      formOpen = false;
      await load();
    } catch (e) {
      formError = e instanceof Error ? e.message : 'Save failed';
    } finally {
      saving = false;
    }
  }

  async function toggleActive(u: UserRow) {
    loadError = '';
    try {
      await apiJson(`/api/admin/users/${u.id}`, {
        method: 'PUT',
        body: JSON.stringify({ active: u.active ? false : true }),
      });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Update failed';
    }
  }
</script>

<svelte:head>
  <title>Users · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Staff accounts</div>
      <Button variant="primary" on:click={openAdd}>+ Add user</Button>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
      <div class="grid grid-cols-[2fr_1fr_1fr_1fr] gap-2 border-b border-counter-paper bg-counter-cream px-5 py-3 text-xs font-bold uppercase tracking-wide text-counter-muted">
        <div>Name</div>
        <div>Role</div>
        <div>Status</div>
        <div></div>
      </div>
      {#if loading}
        <div class="px-5 py-8 text-center text-sm text-counter-muted">Loading…</div>
      {:else}
        {#each users as u (u.id)}
          <div class="grid grid-cols-[2fr_1fr_1fr_1fr] items-center gap-2 border-b border-counter-paper px-5 py-3.5 text-[15px]">
            <div class="font-semibold text-counter-ink">{u.name}</div>
            <div>
              <span class="rounded-full px-2.5 py-1 text-xs font-bold {roleStyle[u.role]}">{u.role}</span>
            </div>
            <div class="font-mono text-xs {u.active ? 'text-counter-paid' : 'text-counter-faint'}">
              {u.active ? 'Active' : 'Deactivated'}
            </div>
            <div class="flex justify-end gap-2 text-sm font-bold">
              <button class="text-counter-muted-2 hover:text-counter-ink" on:click={() => openEdit(u)}>Edit</button>
              <button
                class="text-counter-muted-2 hover:text-counter-orange-dark"
                on:click={() => toggleActive(u)}
              >
                {u.active ? 'Deactivate' : 'Reactivate'}
              </button>
            </div>
          </div>
        {/each}
      {/if}
    </div>
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">{editing ? 'Edit user' : 'Add user'}</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="user-name" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Name</label>
      <input
        id="user-name"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formName}
        placeholder="Full name"
      />

      <label for="user-role" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Role</label>
      <select
        id="user-role"
        class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink"
        bind:value={formRole}
      >
        <option value="staff">Staff</option>
        <option value="manager">Manager</option>
        <option value="admin">Admin</option>
        <option value="kitchen">Kitchen display</option>
      </select>

      <div id="user-pin-label" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">
        {editing ? 'New PIN (leave blank to keep current)' : 'PIN'}
      </div>
      <div class="mb-3 flex justify-center gap-2">
        {#each Array(6) as _, i}
          <div
            class="h-3 w-3 rounded-full border-2 {i < formPin.length
              ? 'border-counter-orange bg-counter-orange'
              : 'border-counter-line bg-transparent'}"
          ></div>
        {/each}
      </div>
      <div class="mb-4" role="group" aria-labelledby="user-pin-label">
        <Keypad keys={PIN_KEYS} on:press={(e) => pressPin(e.detail)} />
      </div>

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
