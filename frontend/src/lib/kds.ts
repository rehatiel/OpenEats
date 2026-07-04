// Shared kitchen/bar display logic — factored out of the kitchen page so a
// station-aware Bar Display can reuse ticket-building/status-advance logic
// instead of duplicating it.
import type { MockTicket, TicketStatus } from './mockData';
import type { OrderRow, Station, ItemStatus } from './orders';

export const LATE_THRESHOLD_MINUTES = 8;

const ROLLUP_PRIORITY: ItemStatus[] = ['new', 'cooking', 'ready', 'completed'];

export const nextItemStatus: Record<ItemStatus, ItemStatus> = {
  new: 'cooking',
  cooking: 'ready',
  ready: 'completed',
  completed: 'completed',
};

export function elapsedLabel(timestamp: string, tick: number): string {
  const totalSeconds = Math.max(0, Math.floor((tick - new Date(timestamp).getTime()) / 1000));
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, '0');
  const ss = String(totalSeconds % 60).padStart(2, '0');
  return `${mm}:${ss}`;
}

// An order's overall kitchen_status is a rollup across BOTH kitchen and bar
// items — not useful for deciding what a single station's display should
// show (e.g. the kitchen finishing its items while a drink is still
// pending would still show "cooking" at the order level). Compute the
// per-station status directly from that station's items instead.
export function stationStatus(order: OrderRow, station: Station): ItemStatus {
  const items = order.items.filter((i) => i.station === station);
  if (items.length === 0) return 'completed';
  return ROLLUP_PRIORITY.find((s) => items.some((i) => i.status === s)) ?? 'completed';
}

export function toTicket(order: OrderRow, tick: number, station: Station): MockTicket {
  const status = stationStatus(order, station);
  const minutesElapsed = (tick - new Date(order.timestamp).getTime()) / 60000;
  const displayStatus: TicketStatus =
    status === 'ready' ? 'ready' : minutesElapsed > LATE_THRESHOLD_MINUTES ? 'late' : (status as TicketStatus);

  return {
    orderId: String(order.id),
    type: order.type,
    table: order.table_identifier ?? undefined,
    customerName: order.customer_name ?? undefined,
    server: order.server_name ?? undefined,
    status: displayStatus,
    elapsed: elapsedLabel(order.timestamp, tick),
    lines: order.items
      .filter((i) => i.station === station)
      .map((i) => ({ quantity: i.quantity, name: i.name, note: i.note ?? undefined })),
  };
}
