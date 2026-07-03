// Demo/placeholder data for "El Camión" — a taco truck — used to render the
// screens visually until the corresponding backend read endpoints exist
// (today the API only has GET /api/health and POST /api/orders). Every
// screen in this scaffold reads from this single module so swapping mock
// data for live fetches later only requires changing the imports here.

export type OrderType = 'dine_in' | 'to_go' | 'delivery';

export interface MockMenuItem {
  id: number;
  name: string;
  // A plain string, not a fixed union — the real menu is admin-editable via
  // /admin/menu, so categories aren't a closed set.
  category: string;
  retail_price: number;
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

export const TAX_RATE = 0.0825;

// The canonical demo order threaded through Order Entry, the Table 4 tile
// on the floor plan, and Checkout — so the numbers agree everywhere.
export interface CartLine {
  menu_item_id: number;
  name: string;
  unit_price: number;
  quantity: number;
  note?: string;
}

export const DEMO_ORDER_ID = 'A47';

export const DEMO_CART: CartLine[] = [
  { menu_item_id: 1, name: 'Al Pastor', unit_price: 3.75, quantity: 3 },
  { menu_item_id: 3, name: 'Barbacoa', unit_price: 4.25, quantity: 2, note: 'no onion' },
  { menu_item_id: 15, name: 'Horchata', unit_price: 3.0, quantity: 2 },
];

export function cartTotals(lines: CartLine[]) {
  const subtotal = lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0);
  const tax = subtotal * TAX_RATE;
  return { subtotal, tax, total: subtotal + tax };
}

// ---- Table management ----

export type TableStatus = 'open' | 'occupied' | 'needs_bill' | 'ready';

export interface MockTable {
  id: string;
  seats: number;
  status: TableStatus;
  minutesOpen?: number;
  total?: number;
  shape?: 'square' | 'round';
  order?: CartLine[];
}

export const TABLES: MockTable[] = [
  { id: '1', seats: 2, status: 'open' },
  { id: '2', seats: 4, status: 'occupied', minutesOpen: 18, total: 34.0 },
  { id: '3', seats: 2, status: 'occupied', minutesOpen: 9, total: 19.25 },
  {
    id: '4',
    seats: 2,
    status: 'needs_bill',
    minutesOpen: 41,
    total: cartTotals(DEMO_CART).total,
    order: DEMO_CART,
  },
  { id: '5', seats: 6, shape: 'round', status: 'occupied', minutesOpen: 24, total: 88.5 },
  { id: '6', seats: 4, status: 'ready', minutesOpen: 6 },
  { id: '7', seats: 4, status: 'open' },
  { id: '8', seats: 2, status: 'needs_bill', minutesOpen: 52, total: 41.0 },
  { id: '9', seats: 4, status: 'occupied', minutesOpen: 12, total: 52.75 },
  { id: '10', seats: 2, status: 'open' },
  { id: '11', seats: 4, status: 'occupied', minutesOpen: 3, total: 14.5 },
];

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
  server?: string;
  status: TicketStatus;
  elapsed: string;
  lines: TicketLine[];
  drinks?: TicketLine[];
}

export const KDS_TICKETS: MockTicket[] = [
  {
    orderId: 'A47',
    type: 'dine_in',
    table: '4',
    server: 'Maya',
    status: 'new',
    elapsed: '01:12',
    lines: [
      { quantity: 3, name: 'Al Pastor' },
      { quantity: 2, name: 'Barbacoa', note: 'no onion' },
    ],
    drinks: [{ quantity: 2, name: 'Horchata' }],
  },
  {
    orderId: 'A48',
    type: 'to_go',
    status: 'cooking',
    elapsed: '04:38',
    lines: [
      { quantity: 4, name: 'Carnitas' },
      { quantity: 1, name: 'Pescado' },
      { quantity: 1, name: 'Chips & Guac' },
    ],
  },
  {
    orderId: 'A46',
    type: 'delivery',
    status: 'late',
    elapsed: '08:52',
    lines: [
      { quantity: 6, name: 'Pollo Asado' },
      { quantity: 3, name: 'Veggie', note: 'extra salsa verde' },
    ],
  },
  {
    orderId: 'A49',
    type: 'dine_in',
    table: '2',
    server: 'Leo',
    status: 'new',
    elapsed: '00:32',
    lines: [
      { quantity: 2, name: 'Chorizo' },
      { quantity: 1, name: 'Nopales' },
    ],
  },
  {
    orderId: 'A45',
    type: 'to_go',
    status: 'ready',
    elapsed: '00:00',
    lines: [
      { quantity: 2, name: 'Al Pastor' },
      { quantity: 1, name: 'Jarritos' },
    ],
  },
];

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

export interface LowStockItem {
  name: string;
  remaining: string;
  runway: string;
  fillPct: number;
  level: 'red' | 'amber';
}

export const LOW_STOCK: LowStockItem[] = [
  { name: 'Corn tortillas', remaining: '2.5kg left', runway: '~1 service', fillPct: 14, level: 'red' },
  { name: 'Barbacoa braised', remaining: '3.1kg left', runway: '~2 services', fillPct: 26, level: 'amber' },
  { name: 'Limes', remaining: '1 case left', runway: '~2 services', fillPct: 30, level: 'amber' },
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
