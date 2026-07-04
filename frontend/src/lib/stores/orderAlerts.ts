// Order-ready alerting — polled independently of /kitchen's and /tables's
// own polls (different query, and this one needs to run everywhere, not
// just on those pages) so a server anywhere in the app gets notified the
// moment a ticket is ready to run, without opening the kitchen display.
import { writable, get } from 'svelte/store';
import { apiJson } from '$lib/api';
import { auth } from '$lib/stores/auth';
import { settings } from '$lib/stores/settings';
import { playReadyBing } from '$lib/sound';
import type { OrderRow, Station } from '$lib/orders';

export interface ReadyAlert {
  orderId: number;
  tableIdentifier: string | null;
  customerName: string | null;
  type: OrderRow['type'];
  stations: Station[];
  itemIds: number[];
  readyAt: string;
}

const POLL_MS = 5000;

export const readyAlerts = writable<ReadyAlert[]>([]);

let pollHandle: ReturnType<typeof setInterval> | null = null;
// Recomputed fresh from each poll's result (not accumulated across
// dismissals) — an order only re-bings if it drops out of the ready list
// (dismissed, or bumped further) and later comes back.
let knownIds = new Set<number>();

async function poll() {
  let orders: OrderRow[];
  try {
    orders = await apiJson<OrderRow[]>('/api/orders?kitchen_status=ready');
  } catch {
    return; // transient network hiccup — next poll retries
  }

  // Scoped to whoever placed the order by default — a server shouldn't get
  // paged for every ticket on the floor, just their own. An admin can widen
  // this to everyone via settings.ready_alert_all_staff (e.g. a small crew
  // that expedites as a team). Orders from before this column existed have
  // no server_user_id to match against, so they fall back to alerting
  // everyone rather than alerting no one.
  const showAllStaff = get(settings).ready_alert_all_staff;
  const currentUserId = get(auth).user?.id ?? null;

  const next: ReadyAlert[] = [];
  for (const order of orders) {
    if (!showAllStaff && order.server_user_id != null && order.server_user_id !== currentUserId) continue;
    const pending = order.items.filter(
      (item) => item.status === 'ready' && item.ready_at && !item.acknowledged_at && item.station !== 'none'
    );
    if (!pending.length) continue;
    next.push({
      orderId: order.id,
      tableIdentifier: order.table_identifier,
      customerName: order.customer_name,
      type: order.type,
      stations: Array.from(new Set(pending.map((item) => item.station))),
      itemIds: pending.map((item) => item.id),
      readyAt: pending.reduce((earliest, item) => (item.ready_at! < earliest ? item.ready_at! : earliest), pending[0].ready_at!),
    });
  }

  if (next.some((a) => !knownIds.has(a.orderId))) {
    playReadyBing();
  }
  knownIds = new Set(next.map((a) => a.orderId));
  readyAlerts.set(next);
}

export function startOrderAlerts() {
  if (pollHandle) return;
  poll();
  pollHandle = setInterval(poll, POLL_MS);
}

export function stopOrderAlerts() {
  if (pollHandle) {
    clearInterval(pollHandle);
    pollHandle = null;
  }
  readyAlerts.set([]);
  knownIds = new Set();
}

// Optimistically drops the alert locally, then acknowledges every item
// behind it server-side so it stays gone once the next poll lands (rather
// than snapping back if acknowledgement is still in flight when a poll
// fires).
export async function dismissAlert(alert: ReadyAlert) {
  readyAlerts.update((alerts) => alerts.filter((a) => a.orderId !== alert.orderId));
  await Promise.all(
    alert.itemIds.map((itemId) =>
      apiJson(`/api/orders/${alert.orderId}/items/${itemId}/acknowledge`, { method: 'PATCH' }).catch(() => {})
    )
  );
}
