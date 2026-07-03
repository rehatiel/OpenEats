const express = require('express');
const { requireAuth } = require('../middleware/auth');

const VALID_TYPES = ['dine_in', 'to_go', 'delivery'];
const VALID_KITCHEN_STATUSES = ['new', 'cooking', 'ready', 'completed'];
const VALID_PAYMENT_STATUSES = ['unpaid', 'paid'];

function createOrdersRouter(db) {
  const router = express.Router();

  const getMenuItem = db.prepare('SELECT id, name, retail_price FROM menu_items WHERE id = ? AND active = 1');
  const getRecipeCost = db.prepare(`
    SELECT COALESCE(SUM(ri.quantity_required * i.unit_cost), 0) AS cost
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.menu_item_id = ?
  `);
  const getTaxRate = db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'");
  const insertOrder = db.prepare(`
    INSERT INTO orders (type, table_identifier, server_name, subtotal, tax, total, calculated_food_cost)
    VALUES (@type, @table_identifier, @server_name, @subtotal, @tax, @total, @calculated_food_cost)
  `);
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, menu_item_id, quantity, note)
    VALUES (?, ?, ?, ?)
  `);
  const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
  const listOrderItems = db.prepare(`
    SELECT oi.id, oi.menu_item_id, oi.quantity, oi.note, mi.name, mi.retail_price AS unit_price
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = ?
    ORDER BY oi.id
  `);

  function serialize(order) {
    return { ...order, items: listOrderItems.all(order.id) };
  }

  // Creates an order and dynamically computes subtotal/tax/total alongside the
  // underlying food cost (sales - food cost = profit) from the current recipe
  // and ingredient cost data at the moment of submission.
  router.post('/', requireAuth, (req, res) => {
    const { type, table_identifier, items } = req.body ?? {};

    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_TYPES.join(', ')}` });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }

    let subtotal = 0;
    let calculatedFoodCost = 0;
    const resolvedItems = [];

    for (const { menu_item_id, quantity, note } of items) {
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
      resolvedItems.push({
        menu_item_id,
        quantity,
        note: typeof note === 'string' && note.trim() !== '' ? note.trim() : null,
      });
    }

    // Read at request time (not cached at boot) so admin edits via
    // /admin/settings apply immediately, without a backend restart.
    const taxRate = Number(getTaxRate.get()?.value ?? 0.0825);
    const tax = subtotal * taxRate;
    const total = subtotal + tax;

    const orderId = db.transaction(() => {
      const { lastInsertRowid } = insertOrder.run({
        type,
        table_identifier: table_identifier ?? null,
        server_name: req.user.name,
        subtotal,
        tax,
        total,
        calculated_food_cost: calculatedFoodCost,
      });

      for (const item of resolvedItems) {
        insertOrderItem.run(lastInsertRowid, item.menu_item_id, item.quantity, item.note);
      }

      return lastInsertRowid;
    })();

    res.status(201).json(serialize(getOrder.get(orderId)));
  });

  // Any authenticated role can read orders — the kitchen display polls this
  // for active tickets and the floor plan polls it for table occupancy.
  router.get('/', requireAuth, (req, res) => {
    const { kitchen_status: kitchenStatusParam, payment_status: paymentStatusParam, table_identifier: tableParam } =
      req.query;

    let sql = 'SELECT * FROM orders WHERE 1=1';
    const params = [];

    if (kitchenStatusParam) {
      const statuses = String(kitchenStatusParam)
        .split(',')
        .filter((s) => VALID_KITCHEN_STATUSES.includes(s));
      if (statuses.length) {
        sql += ` AND kitchen_status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }
    }
    if (paymentStatusParam) {
      const statuses = String(paymentStatusParam)
        .split(',')
        .filter((s) => VALID_PAYMENT_STATUSES.includes(s));
      if (statuses.length) {
        sql += ` AND payment_status IN (${statuses.map(() => '?').join(', ')})`;
        params.push(...statuses);
      }
    }
    if (tableParam) {
      sql += ' AND table_identifier = ?';
      params.push(String(tableParam));
    }

    sql += ' ORDER BY timestamp ASC';

    const orders = db.prepare(sql).all(...params);
    res.json(orders.map(serialize));
  });

  // Bulk-settles every unpaid order for a table in one transaction, so a
  // table that received multiple "send to kitchen" rounds pays off as one
  // tab. Registered before /:id so "pay-table" isn't swallowed as an :id.
  router.patch('/pay-table', requireAuth, (req, res) => {
    const { table_identifier: tableIdentifier } = req.body ?? {};
    if (typeof tableIdentifier !== 'string' || tableIdentifier.trim() === '') {
      return res.status(400).json({ error: 'table_identifier is required' });
    }

    const unpaidIds = db
      .prepare("SELECT id FROM orders WHERE table_identifier = ? AND payment_status = 'unpaid'")
      .all(tableIdentifier)
      .map((r) => r.id);

    if (unpaidIds.length === 0) {
      return res.status(404).json({ error: 'no unpaid orders for this table' });
    }

    const markPaid = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?");
    db.transaction((ids) => ids.forEach((id) => markPaid.run(id)))(unpaidIds);

    res.json({ paid: unpaidIds });
  });

  router.patch('/:id', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const existing = getOrder.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'order not found' });
    }

    const { kitchen_status: kitchenStatus, payment_status: paymentStatus } = req.body ?? {};
    if (kitchenStatus !== undefined && !VALID_KITCHEN_STATUSES.includes(kitchenStatus)) {
      return res.status(400).json({ error: `kitchen_status must be one of: ${VALID_KITCHEN_STATUSES.join(', ')}` });
    }
    if (paymentStatus !== undefined && !VALID_PAYMENT_STATUSES.includes(paymentStatus)) {
      return res.status(400).json({ error: `payment_status must be one of: ${VALID_PAYMENT_STATUSES.join(', ')}` });
    }

    db.prepare('UPDATE orders SET kitchen_status = ?, payment_status = ? WHERE id = ?').run(
      kitchenStatus ?? existing.kitchen_status,
      paymentStatus ?? existing.payment_status,
      id
    );
    res.json(serialize(getOrder.get(id)));
  });

  return router;
}

module.exports = { createOrdersRouter };
