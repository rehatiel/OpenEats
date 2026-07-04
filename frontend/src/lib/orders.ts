// Real order data from the backend order pipeline, and the derivations both
// the floor plan (/tables) and Order Entry's table picker need from it —
// kept in one place so the two surfaces can never disagree about what
// "occupied" or "needs bill" means.
import type { OrderType, TableStatus, Station } from './mockData';

export type { Station };
export type ItemStatus = 'new' | 'cooking' | 'ready' | 'completed';

export interface OrderItemRow {
  id: number;
  menu_item_id: number;
  quantity: number;
  note: string | null;
  name: string;
  unit_price: number;
  station: Station;
  status: ItemStatus;
  // Sum of void/comp/discount adjustments recorded against this line
  // (pre-tax dollars) — 0 for an unadjusted item.
  adjustment_total: number;
}

// Table layout row shape returned by GET /api/tables, shared by the floor
// plan, its admin drag-and-drop editor, and the order-screen table picker so
// they can't drift out of sync on what fields exist. A non-null
// parent_table_id marks a generated seat (see POST /api/tables/:id/seats) —
// an otherwise completely ordinary, independently-orderable table row.
export interface TableLayoutRow {
  id: number;
  label: string;
  seats: number;
  shape: 'square' | 'round';
  pos_x: number;
  pos_y: number;
  width: number;
  height: number;
  sort_order: number;
  // Raw wire value from SQLite (0/1), same convention as `active` elsewhere.
  orderable: number;
  parent_table_id: number | null;
}

// Buckets a table layout into top-level tables and a lookup of seat rows
// generated under each parent — so the floor plan, its admin editor, and the
// order-screen table picker never disagree about which rows are "real"
// tables vs. generated seats.
export function groupTablesByParent(layout: TableLayoutRow[]): {
  parents: TableLayoutRow[];
  seatsByParent: Record<number, TableLayoutRow[]>;
} {
  const seatsByParent: Record<number, TableLayoutRow[]> = {};
  const parents: TableLayoutRow[] = [];
  for (const row of layout) {
    if (row.parent_table_id != null) {
      (seatsByParent[row.parent_table_id] ??= []).push(row);
    } else {
      parents.push(row);
    }
  }
  return { parents, seatsByParent };
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
  // Gross subtotal/tax/total above are the immutable invoice amounts fixed
  // at order creation — never reduced by a later void/comp/discount, since
  // reports' "gross sales" figures are built on them staying that way.
  // These net_* fields are what the guest actually owes right now, and are
  // what checkout/split-bill/floor-plan totals should charge and display.
  net_subtotal: number;
  net_tax: number;
  net_total: number;
  adjustment_total: number;
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

  // net_total (not the gross total) so a table with a comped/voided item
  // shows what's actually still owed, not the pre-adjustment invoice amount.
  const total = ordersForTable.reduce((sum, o) => sum + o.net_total, 0);
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
  // Void/comp/discount amount recorded against this line (pre-tax dollars),
  // 0 if unadjusted — full unit_price*quantity for a fully voided line.
  adjustment_total: number;
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
      adjustment_total: i.adjustment_total,
    }))
  );
}
