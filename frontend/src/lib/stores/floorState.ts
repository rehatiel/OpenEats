import { writable } from 'svelte/store';
import { TABLES } from '$lib/mockData';
import type { MockTable } from '$lib/mockData';

// Live table status (open/occupied/needs_bill/ready, current order, total
// due) is still mock/in-session data — there's no live order-lifecycle
// backend yet. Putting it in a shared store (instead of importing the
// static TABLES array directly) means completing checkout can actually
// clear a table's due amount instead of it staying stuck forever.
function seed(): Record<string, MockTable> {
  return Object.fromEntries(TABLES.map((t) => [t.id, { ...t }]));
}

export const floorState = writable<Record<string, MockTable>>(seed());

// Resets a table to open with no outstanding order/total — called when
// checkout completes for that table.
export function clearTable(label: string) {
  floorState.update((state) => ({
    ...state,
    [label]: { id: label, seats: state[label]?.seats ?? 2, status: 'open' },
  }));
}
