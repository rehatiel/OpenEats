// Demo/placeholder data for "El Camión" — a taco truck — used to render the
// screens visually until the corresponding backend read endpoints exist
// (today the API only has GET /api/health and POST /api/orders). Every
// screen in this scaffold reads from this single module so swapping mock
// data for live fetches later only requires changing the imports here.

export type OrderType = 'dine_in' | 'to_go' | 'delivery';

export interface MenuItemOption {
  id: number;
  label: string;
}

export interface MockMenuItem {
  id: number;
  name: string;
  // A plain string, not a fixed union — the real menu is admin-editable via
  // /admin/menu, so categories aren't a closed set.
  category: string;
  retail_price: number;
  image_url?: string | null;
  options?: MenuItemOption[];
}

export const MENU_ITEMS: MockMenuItem[] = [
  { id: 1, name: 'Al Pastor', category: 'Tacos', retail_price: 3.75 },
  { id: 2, name: 'Carnitas', category: 'Tacos', retail_price: 3.75 },
  { id: 3, name: 'Barbacoa', category: 'Tacos', retail_price: 4.25 },
  { id: 4, name: 'Pollo Asado', category: 'Tacos', retail_price: 3.5 },
  { id: 5, name: 'Pescado', category: 'Tacos', retail_price: 4.5 },
  { id: 6, name: 'Nopales', category: 'Tacos', retail_price: 3.25 },
  { id: 7, name: 'Chorizo', category: 'Tacos', retail_price: 3.75 },
  { id: 8, name: 'Veggie', category: 'Tacos', retail_price: 3.25 },
  { id: 9, name: 'Al Pastor Burrito', category: 'Burritos', retail_price: 8.5 },
  { id: 10, name: 'Carnitas Burrito', category: 'Burritos', retail_price: 8.5 },
  { id: 11, name: 'Veggie Burrito', category: 'Burritos', retail_price: 7.75 },
  { id: 12, name: 'Chips & Guac', category: 'Sides', retail_price: 5.5 },
  { id: 13, name: 'Chips & Salsa', category: 'Sides', retail_price: 3.5 },
  { id: 14, name: 'Elote', category: 'Sides', retail_price: 4.0 },
  { id: 15, name: 'Horchata', category: 'Drinks', retail_price: 3.0 },
  { id: 16, name: 'Jarritos', category: 'Drinks', retail_price: 2.5 },
  { id: 17, name: 'Agua Fresca', category: 'Drinks', retail_price: 3.0 },
  { id: 18, name: 'Salsa Verde', category: 'Salsas', retail_price: 0.75 },
  { id: 19, name: 'Salsa Roja', category: 'Salsas', retail_price: 0.75 },
  { id: 20, name: 'Pico de Gallo', category: 'Salsas', retail_price: 0.75 },
];

export const CATEGORIES = ['Tacos', 'Burritos', 'Sides', 'Drinks', 'Salsas'] as const;

export interface CartLine {
  menu_item_id: number;
  name: string;
  unit_price: number;
  quantity: number;
  note?: string;
  // Carried from the menu item at add-to-cart time so the cart's "Customize"
  // sheet can render this line's quick-customization chips without needing
  // the full menu list threaded down to it.
  options?: MenuItemOption[];
}

// ---- Table management ----

// 'ordered' (kitchen hasn't started) and 'cooking' (in progress) are surfaced
// separately so the floor plan shows kitchen progress at a glance, not just
// an undifferentiated "occupied".
export type TableStatus = 'open' | 'ordered' | 'cooking' | 'ready' | 'needs_bill';

// Deliberately lighter than CartLine (no menu_item_id) — a table's displayed
// order is a read-only combined view across possibly several real backend
// orders, not something added to/removed from by id like an active cart.
export interface TableOrderLine {
  quantity: number;
  name: string;
  unit_price: number;
  note?: string;
}

export interface MockTable {
  id: string;
  seats: number;
  status: TableStatus;
  minutesOpen?: number;
  total?: number;
  shape?: 'square' | 'round';
  order?: TableOrderLine[];
  // false marks a floor landmark (e.g. a service window) rather than a real
  // orderable table — rendered as a plain label pill and excluded from
  // Order Entry's table picker. Absent/true means a normal table.
  orderable?: boolean;
}

// ---- Kitchen Display System ----

export type TicketStatus = 'new' | 'cooking' | 'ready' | 'late';

export interface TicketLine {
  quantity: number;
  name: string;
  note?: string;
}

export interface MockTicket {
  orderId: string;
  type: OrderType;
  table?: string;
  customerName?: string;
  server?: string;
  status: TicketStatus;
  elapsed: string;
  lines: TicketLine[];
  drinks?: TicketLine[];
}

// ---- Financials dashboard ----

export const DASHBOARD_KPIS = {
  grossSales: 14820,
  grossSalesDelta: '+8.4% vs last wk',
  foodCost: 4890,
  foodCostPct: '33.0% of sales',
  grossProfit: 9930,
  grossProfitMargin: '67.0% margin',
  orders: 642,
  avgTicket: 23.08,
};

export interface DashboardDay {
  label: string;
  salesPct: number;
  foodCostPct: number;
}

export const DASHBOARD_WEEK: DashboardDay[] = [
  { label: 'Th', salesPct: 58, foodCostPct: 20 },
  { label: 'Fr', salesPct: 66, foodCostPct: 22 },
  { label: 'Sa', salesPct: 92, foodCostPct: 30 },
  { label: 'Su', salesPct: 78, foodCostPct: 26 },
  { label: 'Mo', salesPct: 44, foodCostPct: 15 },
  { label: 'Tu', salesPct: 52, foodCostPct: 17 },
  { label: 'We', salesPct: 70, foodCostPct: 23 },
];


export interface MarginRow {
  name: string;
  price: number;
  foodCost: number;
  sold: number;
  marginPct: number;
}

export const MARGIN_TABLE: MarginRow[] = [
  { name: 'Al Pastor Taco', price: 3.75, foodCost: 1.02, sold: 318, marginPct: 73 },
  { name: 'Barbacoa Taco', price: 4.25, foodCost: 1.71, sold: 204, marginPct: 60 },
  { name: 'Chips & Guac', price: 5.5, foodCost: 2.86, sold: 142, marginPct: 48 },
  { name: 'Horchata', price: 3.0, foodCost: 0.42, sold: 276, marginPct: 86 },
];
