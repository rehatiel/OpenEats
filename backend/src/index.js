require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/init');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createTablesRouter } = require('./routes/tables');
const { createSettingsRouter } = require('./routes/settings');
const { createMenuRouter } = require('./routes/menu');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/openeats.db';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set — refusing to start with no way to sign staff sign-in tokens.');
  process.exit(1);
}

const db = initDb(DB_PATH);

const getMenuItem = db.prepare('SELECT id, name, retail_price FROM menu_items WHERE id = ? AND active = 1');
const getRecipeCost = db.prepare(`
  SELECT COALESCE(SUM(ri.quantity_required * i.unit_cost), 0) AS cost
  FROM recipe_items ri
  JOIN ingredients i ON i.id = ri.ingredient_id
  WHERE ri.menu_item_id = ?
`);
const getTaxRate = db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'");
const insertOrder = db.prepare(`
  INSERT INTO orders (type, table_identifier, status, subtotal, tax, total, calculated_food_cost)
  VALUES (@type, @table_identifier, 'open', @subtotal, @tax, @total, @calculated_food_cost)
`);
const insertOrderItem = db.prepare(`
  INSERT INTO order_items (order_id, menu_item_id, quantity)
  VALUES (?, ?, ?)
`);

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', createAuthRouter(db));
app.use('/api/admin/users', createUsersRouter(db));
app.use('/api/tables', createTablesRouter(db));
app.use('/api/settings', createSettingsRouter(db));
app.use('/api/menu', createMenuRouter(db));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Creates an order and dynamically computes subtotal/tax/total alongside the
// underlying food cost (sales - food cost = profit) from the current recipe
// and ingredient cost data at the moment of submission.
app.post('/api/orders', (req, res) => {
  const { type, table_identifier, items } = req.body ?? {};

  const validTypes = ['dine_in', 'to_go', 'delivery'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: `type must be one of: ${validTypes.join(', ')}` });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'items must be a non-empty array' });
  }

  let subtotal = 0;
  let calculatedFoodCost = 0;
  const resolvedItems = [];

  for (const { menu_item_id, quantity } of items) {
    const menuItem = getMenuItem.get(menu_item_id);
    if (!menuItem) {
      return res.status(400).json({ error: `menu_item_id ${menu_item_id} does not exist` });
    }
    if (!Number.isInteger(quantity) || quantity <= 0) {
      return res.status(400).json({ error: `invalid quantity for menu_item_id ${menu_item_id}` });
    }

    const { cost: unitFoodCost } = getRecipeCost.get(menu_item_id);
    subtotal += menuItem.retail_price * quantity;
    calculatedFoodCost += unitFoodCost * quantity;
    resolvedItems.push({ menu_item_id, quantity });
  }

  // Read at request time (not cached at boot) so admin edits via
  // /admin/settings apply immediately, without a backend restart.
  const taxRate = Number(getTaxRate.get()?.value ?? 0.0825);
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const order = db.transaction(() => {
    const { lastInsertRowid: orderId } = insertOrder.run({
      type,
      table_identifier: table_identifier ?? null,
      subtotal,
      tax,
      total,
      calculated_food_cost: calculatedFoodCost,
    });

    for (const { menu_item_id, quantity } of resolvedItems) {
      insertOrderItem.run(orderId, menu_item_id, quantity);
    }

    return { id: orderId };
  })();

  res.status(201).json({
    id: order.id,
    type,
    table_identifier: table_identifier ?? null,
    status: 'open',
    items: resolvedItems,
    subtotal,
    tax,
    total,
    calculated_food_cost: calculatedFoodCost,
    profit: subtotal - calculatedFoodCost,
  });
});

app.listen(PORT, () => {
  console.log(`OpenEats backend listening on port ${PORT}`);
});
