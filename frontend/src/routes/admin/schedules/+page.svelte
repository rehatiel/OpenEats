<script lang="ts">
  import { onMount } from 'svelte';
  import { apiJson } from '$lib/api';
  import Button from '$lib/components/Button.svelte';

  interface UserRow {
    id: number;
    name: string;
    active: number;
  }

  interface ScheduleRow {
    id: number;
    user_id: number;
    user_name: string;
    starts_at: string;
    ends_at: string;
    notes: string | null;
  }

  function startOfWeek(): string {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay());
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }
  function endOfWeek(): string {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 7);
    d.setHours(0, 0, 0, 0);
    return d.toISOString().slice(0, 10);
  }

  let rangeStart = startOfWeek();
  let rangeEnd = endOfWeek();
  let schedules: ScheduleRow[] = [];
  let users: UserRow[] = [];
  let loading = true;
  let loadError = '';
  let viewMode: 'calendar' | 'list' = 'calendar';

  // Calendar grid geometry — a fixed 6am-midnight window at a constant
  // pixel-per-hour scale, the same "absolutely positioned within a
  // relative container" idiom the floor plan uses for table tiles.
  const HOUR_START = 6;
  const HOUR_END = 24;
  const HOUR_PX = 40;
  const hourMarks = Array.from({ length: HOUR_END - HOUR_START + 1 }, (_, i) => HOUR_START + i);

  function dateKey(d: Date): string {
    return d.toISOString().slice(0, 10);
  }
  function hourLabel(h: number): string {
    const hour12 = h % 12 === 0 ? 12 : h % 12;
    return `${hour12}${h < 12 || h === 24 ? 'a' : 'p'}`;
  }

  // Local calendar days spanning [rangeStart, rangeEnd) — deliberately
  // browser-local, not restaurant_timezone-aware (that setting isn't wired
  // into the frontend yet); fine in practice since staff view this on a
  // terminal physically at the restaurant.
  $: days = (() => {
    const start = new Date(`${rangeStart}T00:00:00`);
    const end = new Date(`${rangeEnd}T00:00:00`);
    const out: Date[] = [];
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      out.push(new Date(d));
    }
    return out;
  })();

  // A shift is placed on the calendar day it STARTS — same "don't split at
  // midnight" convention the backend uses for punches/schedules — and
  // clipped to the visible 6am-midnight window if it runs outside it.
  $: blocksByDay = (() => {
    const map = new Map<string, { schedule: ScheduleRow; top: number; height: number }[]>();
    for (const s of schedules) {
      const start = new Date(s.starts_at);
      const end = new Date(s.ends_at);
      const key = dateKey(start);
      const startHour = Math.max(HOUR_START, start.getHours() + start.getMinutes() / 60);
      const sameDay = dateKey(end) === key;
      const endHour = Math.min(HOUR_END, sameDay ? end.getHours() + end.getMinutes() / 60 : HOUR_END);
      const top = (startHour - HOUR_START) * HOUR_PX;
      const height = Math.max(22, (endHour - startHour) * HOUR_PX);
      const list = map.get(key) ?? [];
      list.push({ schedule: s, top, height });
      map.set(key, list);
    }
    return map;
  })();

  let formOpen = false;
  let formUserId: number | null = null;
  let formStartsAt = '';
  let formEndsAt = '';
  let formNotes = '';
  let formError = '';
  let saving = false;

  async function load() {
    loading = true;
    try {
      [schedules, users] = await Promise.all([
        apiJson<ScheduleRow[]>(`/api/schedules?start=${rangeStart}T00:00:00.000Z&end=${rangeEnd}T00:00:00.000Z`),
        apiJson<UserRow[]>('/api/admin/users'),
      ]);
      loadError = '';
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to load schedules';
    } finally {
      loading = false;
    }
  }

  onMount(load);

  function openAdd() {
    formUserId = users.find((u) => u.active)?.id ?? null;
    formStartsAt = '';
    formEndsAt = '';
    formNotes = '';
    formError = '';
    formOpen = true;
  }

  async function save() {
    formError = '';
    if (!formUserId) {
      formError = 'Select an employee';
      return;
    }
    if (!formStartsAt || !formEndsAt) {
      formError = 'Start and end are required';
      return;
    }
    saving = true;
    try {
      await apiJson('/api/schedules', {
        method: 'POST',
        body: JSON.stringify({
          user_id: formUserId,
          starts_at: new Date(formStartsAt).toISOString(),
          ends_at: new Date(formEndsAt).toISOString(),
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

  async function remove(id: number) {
    if (!confirm('Delete this shift?')) return;
    try {
      await apiJson(`/api/schedules/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      loadError = e instanceof Error ? e.message : 'Failed to delete shift';
    }
  }

  function fmt(iso: string) {
    return new Date(iso).toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
</script>

<svelte:head>
  <title>Schedules · Admin · OpenEats</title>
</svelte:head>

<div class="flex h-full">
  <div class="min-w-0 flex-1 overflow-y-auto p-6">
    <div class="mb-5 flex items-center justify-between">
      <div class="text-xl font-extrabold text-counter-ink">Schedules</div>
      <Button variant="primary" on:click={openAdd}>+ Add shift</Button>
    </div>

    <div class="mb-4 flex items-center gap-3">
      <input type="date" class="h-10 rounded-lg border border-counter-line bg-white px-3 text-sm text-counter-ink" bind:value={rangeStart} on:change={load} />
      <span class="text-sm text-counter-muted">to</span>
      <input type="date" class="h-10 rounded-lg border border-counter-line bg-white px-3 text-sm text-counter-ink" bind:value={rangeEnd} on:change={load} />

      <div class="ml-auto flex gap-1.5 rounded-xl bg-counter-tabs p-1.5">
        {#each [{ key: 'calendar', label: 'Calendar' }, { key: 'list', label: 'List' }] as v (v.key)}
          <button
            class="rounded-lg px-3.5 py-1.5 text-sm font-bold {viewMode === v.key ? 'bg-counter-ink text-white' : 'text-counter-muted-2'}"
            on:click={() => (viewMode = v.key)}
          >
            {v.label}
          </button>
        {/each}
      </div>
    </div>

    {#if loadError}
      <div class="mb-4 rounded-lg bg-[#FEF0E9] px-4 py-2.5 text-sm font-semibold text-[#C2410C]">{loadError}</div>
    {/if}

    {#if loading}
      <div class="text-sm text-counter-muted">Loading…</div>
    {:else if viewMode === 'calendar'}
      {#if days.length === 0}
        <div class="px-2 py-8 text-center text-sm text-counter-muted">Pick a date range to see the calendar.</div>
      {:else}
        <div class="overflow-x-auto rounded-2xl border border-counter-line bg-white">
          <div class="flex" style="min-width: {60 + days.length * 140}px;">
            <!-- hour gutter -->
            <div class="flex-none" style="width: 52px;">
              <div class="h-11 border-b border-counter-paper"></div>
              <div class="relative" style="height: {(HOUR_END - HOUR_START) * HOUR_PX}px;">
                {#each hourMarks as h}
                  <div
                    class="absolute right-1.5 -translate-y-1/2 font-mono text-[11px] text-counter-muted"
                    style="top: {(h - HOUR_START) * HOUR_PX}px;"
                  >
                    {hourLabel(h)}
                  </div>
                {/each}
              </div>
            </div>

            {#each days as day (dateKey(day))}
              <div class="flex-1 border-l border-counter-paper" style="min-width: 140px;">
                <div class="flex h-11 flex-col items-center justify-center border-b border-counter-paper">
                  <div class="text-xs font-bold uppercase tracking-wide text-counter-muted">{day.toLocaleDateString([], { weekday: 'short' })}</div>
                  <div class="font-mono text-xs text-counter-muted-2">{day.toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
                </div>
                <div
                  class="relative"
                  style="height: {(HOUR_END - HOUR_START) * HOUR_PX}px; background-image: repeating-linear-gradient(to bottom, #F2EDE3 0, #F2EDE3 1px, transparent 1px, transparent {HOUR_PX}px);"
                >
                  {#each blocksByDay.get(dateKey(day)) ?? [] as b (b.schedule.id)}
                    <button
                      class="absolute left-1 right-1 overflow-hidden rounded-lg bg-counter-dinein px-2 py-1 text-left shadow-sm"
                      style="top: {b.top}px; height: {b.height}px;"
                      on:click={() => remove(b.schedule.id)}
                      title="Click to delete"
                    >
                      <div class="truncate text-xs font-bold text-white">{b.schedule.user_name}</div>
                      <div class="truncate font-mono text-[10px] text-[#BCD0FF]">
                        {fmt(b.schedule.starts_at).split(', ').pop()} – {fmt(b.schedule.ends_at).split(', ').pop()}
                      </div>
                    </button>
                  {/each}
                </div>
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {:else}
      <div class="overflow-hidden rounded-2xl border border-counter-line bg-white">
        <div class="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr_auto] gap-2 border-b border-counter-paper px-5 py-2.5 text-xs font-bold uppercase tracking-wide text-counter-muted">
          <div>Employee</div>
          <div>Starts</div>
          <div>Ends</div>
          <div>Notes</div>
          <div></div>
        </div>
        {#each schedules as s (s.id)}
          <div class="grid grid-cols-[1.5fr_1.5fr_1.5fr_1fr_auto] items-center gap-2 border-b border-counter-paper px-5 py-3 text-[15px] last:border-b-0">
            <div class="font-semibold text-counter-ink">{s.user_name}</div>
            <div class="font-mono text-sm text-counter-muted-2">{fmt(s.starts_at)}</div>
            <div class="font-mono text-sm text-counter-muted-2">{fmt(s.ends_at)}</div>
            <div class="text-counter-muted-2">{s.notes ?? '—'}</div>
            <button class="text-xs font-bold text-counter-orange-dark" on:click={() => remove(s.id)}>Delete</button>
          </div>
        {/each}
        {#if schedules.length === 0}
          <div class="px-2 py-8 text-center text-sm text-counter-muted">No shifts scheduled in this range.</div>
        {/if}
      </div>
    {/if}
  </div>

  {#if formOpen}
    <div class="flex w-[360px] flex-none flex-col overflow-y-auto border-l border-counter-line bg-white p-5">
      <div class="mb-4 flex items-center justify-between">
        <div class="text-lg font-extrabold text-counter-ink">Add shift</div>
        <button class="text-sm font-bold text-counter-muted-2" on:click={() => (formOpen = false)}>Close</button>
      </div>

      <label for="sched-user" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Employee</label>
      <select id="sched-user" class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink" bind:value={formUserId}>
        {#each users.filter((u) => u.active) as u (u.id)}
          <option value={u.id}>{u.name}</option>
        {/each}
      </select>

      <label for="sched-start" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Starts</label>
      <input id="sched-start" type="datetime-local" class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink" bind:value={formStartsAt} />

      <label for="sched-end" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Ends</label>
      <input id="sched-end" type="datetime-local" class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink" bind:value={formEndsAt} />

      <label for="sched-notes" class="mb-1 text-xs font-bold uppercase tracking-wide text-counter-muted">Notes</label>
      <input id="sched-notes" class="mb-4 h-11 rounded-lg border border-counter-line bg-counter-paper px-3 text-[15px] text-counter-ink" bind:value={formNotes} />

      {#if formError}
        <div class="mb-3 text-sm font-semibold text-counter-orange-dark">{formError}</div>
      {/if}

      <Button variant="success" fullWidth on:click={save} disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </Button>
    </div>
  {/if}
</div>
