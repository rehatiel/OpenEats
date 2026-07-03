// Mirrors the SQLite schema defined in backend/src/db/init.js.

export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  current_stock: number;
  unit_cost: number;
}

export interface MenuItem {
  id: number;
  name: string;
  retail_price: number;
  category: string | null;
}

export interface RecipeItem {
  menu_item_id: number;
  ingredient_id: number;
  quantity_required: number;
}

export type OrderType = 'dine_in' | 'to_go' | 'delivery';
export type OrderStatus = 'open' | 'in_progress' | 'completed' | 'cancelled';

export interface Order {
  id: number;
  type: OrderType;
  table_identifier: string | null;
  status: OrderStatus;
  subtotal: number;
  tax: number;
  total: number;
  calculated_food_cost: number;
  timestamp: string;
}

export interface OrderItem {
  id: number;
  order_id: number;
  menu_item_id: number;
  quantity: number;
}

// Request body shape for POST /api/orders.
export interface OrderSubmission {
  type: OrderType;
  table_identifier?: string | null;
  items: Array<Pick<OrderItem, 'menu_item_id' | 'quantity'>>;
}

// Response shape returned by POST /api/orders (order + derived financials).
export interface OrderSubmissionResult extends Omit<Order, 'timestamp'> {
  items: Array<Pick<OrderItem, 'menu_item_id' | 'quantity'>>;
  profit: number;
}
