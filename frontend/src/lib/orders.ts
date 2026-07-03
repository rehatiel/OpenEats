// Real order data from the backend order pipeline, and the derivations both
// the floor plan (/tables) and Order Entry's table picker need from it —
// kept in one place so the two surfaces can never disagree about what
// "occupied" or "needs bill" means.
import type { OrderType, TableStatus } from './mockData';

export interface OrderItemRow {
  id: number;
  menu_item_id: number;
  quantity: number;
  note: string | null;
  name: string;
  unit_price: number;
}

export type KitchenStatus = 'new' | 'cooking' | 'ready' | 'completed';
export type PaymentStatus = 'unpaid' | 'paid';

export interface OrderRow {
  id: number;
  type: OrderType;
  table_identifier: string | null;
  customer_name: string | null;
  server_name: string | null;
  kitchen_status: KitchenStatus;
  payment_status: PaymentStatus;
  subtotal: number;
  tax: number;
  total: number;
  calculated_food_cost: number;
  timestamp: string;
  bill_printed_at: string | null;
  items: OrderItemRow[];
}

export function groupOrdersByTable(orders: OrderRow[]): Record<string, OrderRow[]> {
  const grouped: Record<string, OrderRow[]> = {};
  for (const order of orders) {
    if (!order.table_identifier) continue;
    (grouped[order.table_identifier] ??= []).push(order);
  }
  return grouped;
}

// A table can carry several unpaid orders at once (one per "send to
// kitchen" round) — priority is: anything not yet started by the kitchen >
// anything still being cooked > food ready and waiting > everything cooked
// but nobody's paid yet > nothing open. Surfacing "ordered" vs "cooking"
// separately (rather than one collapsed "occupied") is what lets the floor
// plan show kitchen progress at a glance.
export function deriveTableStatus(ordersForTable: OrderRow[] | undefined): TableStatus {
  if (!ordersForTable || ordersForTable.length === 0) return 'open';
  if (ordersForTable.some((o) => o.kitchen_status === 'new')) return 'ordered';
  if (ordersForTable.some((o) => o.kitchen_status === 'cooking')) return 'cooking';
  if (ordersForTable.some((o) => o.kitchen_status === 'ready')) return 'ready';
  return 'needs_bill';
}

export interface TableSummary {
  status: TableStatus;
  minutesOpen?: number;
  total?: number;
}

export function summarizeTable(ordersForTable: OrderRow[] | undefined): TableSummary {
  if (!ordersForTable || ordersForTable.length === 0) return { status: 'open' };

  const total = ordersForTable.reduce((sum, o) => sum + o.total, 0);
  const oldestMs = Math.min(...ordersForTable.map((o) => new Date(o.timestamp).getTime()));
  const minutesOpen = Math.max(0, Math.round((Date.now() - oldestMs) / 60000));

  return { status: deriveTableStatus(ordersForTable), minutesOpen, total };
}

export interface CombinedLine {
  id: number;
  quantity: number;
  name: string;
  unit_price: number;
  note?: string;
}

// Flattens every round sent for a table into one line list for display —
// deliberately not merged by name, since each "send" is its own fire and a
// repeated dish in a later round is a genuinely separate line on the ticket.
// `id` (the underlying order_items row id) gives split-bill assignment a
// stable key even when two lines share a name.
export function combineOrderLines(ordersForTable: OrderRow[]): CombinedLine[] {
  return ordersForTable.flatMap((o) =>
    o.items.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      name: i.name,
      unit_price: i.unit_price,
      note: i.note ?? undefined,
    }))
  );
}
