const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { findUserByPin } = require('../lib/pin');
const { createOrderTotalsHelper } = require('../lib/orderTotals');

const VALID_TYPES = ['dine_in', 'to_go', 'delivery'];
const VALID_KITCHEN_STATUSES = ['new', 'cooking', 'ready', 'completed'];
const VALID_PAYMENT_STATUSES = ['unpaid', 'paid'];
const VALID_STATIONS = ['kitchen', 'bar', 'none'];
const ROLLUP_STATIONS = ['kitchen', 'bar'];
const VALID_ADJUSTMENT_TYPES = ['void', 'comp', 'discount'];
const MANAGER_ROLES = ['admin', 'manager'];
// Priority order for rolling per-item statuses up to a single order-level
// kitchen_status — an order is only as "done" as its least-done item.
const ROLLUP_PRIORITY = ['new', 'cooking', 'ready', 'completed'];

function createOrdersRouter(db) {
  const router = express.Router();
  const { computeNetTotals } = createOrderTotalsHelper(db);

  const getMenuItem = db.prepare('SELECT id, name, retail_price, station FROM menu_items WHERE id = ? AND active = 1');
  const getRecipeCost = db.prepare(`
    SELECT COALESCE(SUM(ri.quantity_required * i.unit_cost), 0) AS cost
    FROM recipe_items ri
    JOIN ingredients i ON i.id = ri.ingredient_id
    WHERE ri.menu_item_id = ?
  `);
  const getTaxRate = db.prepare("SELECT value FROM settings WHERE key = 'tax_rate'");
  const getRecipeLines = db.prepare('SELECT ingredient_id, quantity_required FROM recipe_items WHERE menu_item_id = ?');
  const decrementStock = db.prepare('UPDATE ingredients SET current_stock = current_stock - ? WHERE id = ?');
  const insertOrder = db.prepare(`
    INSERT INTO orders (type, table_identifier, customer_name, server_name, subtotal, tax, total, calculated_food_cost)
    VALUES (@type, @table_identifier, @customer_name, @server_name, @subtotal, @tax, @total, @calculated_food_cost)
  `);
  const insertOrderItem = db.prepare(`
    INSERT INTO order_items (order_id, menu_item_id, quantity, note, station, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
  const listOrderItems = db.prepare(`
    SELECT oi.id, oi.menu_item_id, oi.quantity, oi.note, oi.station, oi.status, mi.name, mi.retail_price AS unit_price,
           COALESCE((SELECT SUM(oia.amount) FROM order_item_adjustments oia WHERE oia.order_item_id = oi.id), 0) AS adjustment_total
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.order_id = ?
    ORDER BY oi.id
  `);
  const getRollupItemStatuses = db.prepare(
    `SELECT status FROM order_items WHERE order_id = ? AND station IN (${ROLLUP_STATIONS.map(() => '?').join(', ')})`
  );
  const setOrderKitchenStatus = db.prepare('UPDATE orders SET kitchen_status = ? WHERE id = ?');
  const setAllItemStatus = db.prepare(
    `UPDATE order_items SET status = ? WHERE order_id = ? AND station IN (${ROLLUP_STATIONS.map(() => '?').join(', ')})`
  );
  const setStationItemStatus = db.prepare('UPDATE order_items SET status = ? WHERE order_id = ? AND station = ?');

  const getOrderItemForOrder = db.prepare(`
    SELECT oi.id, oi.order_id, oi.menu_item_id, oi.quantity, oi.status, mi.retail_price AS unit_price
    FROM order_items oi
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    WHERE oi.id = ? AND oi.order_id = ?
  `);
  const sumItemAdjustments = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM order_item_adjustments WHERE order_item_id = ?'
  );
  const sumOrderAdjustments = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM order_adjustments WHERE order_id = ?'
  );
  const insertItemAdjustment = db.prepare(`
    INSERT INTO order_item_adjustments (order_item_id, type, amount, reason, authorized_by_user_id, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const insertOrderAdjustment = db.prepare(`
    INSERT INTO order_adjustments (order_id, type, amount, reason, authorized_by_user_id, created_by_user_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  const incrementStock = db.prepare('UPDATE ingredients SET current_stock = current_stock + ? WHERE id = ?');
  const setItemStatusById = db.prepare('UPDATE order_items SET status = ? WHERE id = ?');
  const listItemAdjustments = db.prepare(
    'SELECT * FROM order_item_adjustments WHERE order_item_id = ? ORDER BY created_at'
  );
  const listOrderAdjustmentsFor = db.prepare('SELECT * FROM order_adjustments WHERE order_id = ? ORDER BY created_at');

  function serialize(order) {
    return { ...order, ...computeNetTotals(order), items: listOrderItems.all(order.id) };
  }

  // Voids/comps/discounts require a manager (or admin) to authorize —
  // verified by PIN independent of who's currently logged in (a staff
  // member can initiate one that a manager walks over and approves without
  // a separate login), reusing the same linear PIN scan login already uses.
  function resolveManagerApproval(req, res) {
    const { manager_pin: managerPin } = req.body ?? {};
    if (typeof managerPin !== 'string' || managerPin.trim() === '') {
      res.status(400).json({ error: 'manager_pin is required' });
      return null;
    }
    const manager = findUserByPin(db, managerPin);
    if (!manager || !MANAGER_ROLES.includes(manager.role)) {
      res.status(403).json({ error: 'manager_pin did not match an active manager or admin' });
      return null;
    }
    return manager;
  }

  // orders.kitchen_status is a rollup over its non-'none'-station items —
  // this keeps the order-level field's existing read contract (floor plan,
  // GET filters, the kitchen page) intact while the actual prep state lives
  // per item. An order with no kitchen/bar items (e.g. all 'none') rolls up
  // to 'completed' since nothing is left to track.
  function recomputeOrderKitchenStatus(orderId) {
    const items = getRollupItemStatuses.all(orderId, ...ROLLUP_STATIONS);
    const status = items.length === 0 ? 'completed' : ROLLUP_PRIORITY.find((s) => items.some((i) => i.status === s)) ?? 'completed';
    setOrderKitchenStatus.run(status, orderId);
    return status;
  }

  // Creates an order and dynamically computes subtotal/tax/total alongside the
  // underlying food cost (sales - food cost = profit) from the current recipe
  // and ingredient cost data at the moment of submission.
  router.post('/', requireAuth, (req, res) => {
    const { type, table_identifier, customer_name: customerNameRaw, items } = req.body ?? {};
    const customerName =
      typeof customerNameRaw === 'string' && customerNameRaw.trim() !== '' ? customerNameRaw.trim() : null;

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
        // Snapshotted at order time so reclassifying a menu item later
        // (e.g. bar -> kitchen) doesn't rewrite historical tickets. Items
        // with no station (e.g. a bottled drink) never appear on a display
        // and are inserted already 'completed'.
        station: menuItem.station,
        status: menuItem.station === 'none' ? 'completed' : 'new',
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
        customer_name: customerName,
        server_name: req.user.name,
        subtotal,
        tax,
        total,
        calculated_food_cost: calculatedFoodCost,
      });

      for (const item of resolvedItems) {
        insertOrderItem.run(lastInsertRowid, item.menu_item_id, item.quantity, item.note, item.station, item.status);
        // Ingredients are consumed as soon as the kitchen is told to make the
        // item, not when it's paid for. Items with no recipe built yet (the
        // common case until an admin sets one up) simply deduct nothing.
        for (const line of getRecipeLines.all(item.menu_item_id)) {
          decrementStock.run(line.quantity_required * item.quantity, line.ingredient_id);
        }
      }
      recomputeOrderKitchenStatus(lastInsertRowid);

      return lastInsertRowid;
    })();

    res.status(201).json(serialize(getOrder.get(orderId)));
  });

  // Any authenticated role can read orders — the kitchen display polls this
  // for active tickets and the floor plan polls it for table occupancy.
  router.get('/', requireAuth, (req, res) => {
    const {
      kitchen_status: kitchenStatusParam,
      payment_status: paymentStatusParam,
      table_identifier: tableParam,
      type: typeParam,
      station: stationParam,
    } = req.query;

    let sql = 'SELECT DISTINCT o.* FROM orders o';
    const params = [];
    const conditions = [];

    if (stationParam) {
      const stations = String(stationParam)
        .split(',')
        .filter((s) => VALID_STATIONS.includes(s));
      if (stations.length) {
        sql += ' JOIN order_items oi ON oi.order_id = o.id';
        conditions.push(`oi.station IN (${stations.map(() => '?').join(', ')})`);
        params.push(...stations);
      }
    }

    sql += conditions.length ? ` WHERE ${conditions.join(' AND ')}` : ' WHERE 1=1';

    if (typeParam) {
      const types = String(typeParam)
        .split(',')
        .filter((t) => VALID_TYPES.includes(t));
      if (types.length) {
        sql += ` AND type IN (${types.map(() => '?').join(', ')})`;
        params.push(...types);
      }
    }
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

  router.get('/:id', requireAuth, (req, res) => {
    const order = getOrder.get(Number(req.params.id));
    if (!order) {
      return res.status(404).json({ error: 'order not found' });
    }
    res.json(serialize(order));
  });

  // Stamps every currently-unpaid order for a table as having had its bill
  // printed — surfaced on the Register queue so front-counter staff can see
  // which tables have already been given their check. Registered before
  // /:id so "mark-bill-printed" isn't swallowed as an :id.
  router.patch('/mark-bill-printed', requireAuth, (req, res) => {
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

    const stamp = db.prepare("UPDATE orders SET bill_printed_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?");
    db.transaction((ids) => ids.forEach((id) => stamp.run(id)))(unpaidIds);

    res.json({ marked: unpaidIds });
  });

  // Legacy/"advance everything" contract, unchanged from before per-item
  // routing existed — supplying kitchen_status here advances every
  // kitchen/bar item on the order together, so the existing kitchen page
  // keeps working with zero changes. A station-aware display should use
  // PATCH /:id/station-status instead so a mixed order's other station
  // isn't force-advanced alongside it.
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

    db.transaction(() => {
      if (kitchenStatus !== undefined) {
        setAllItemStatus.run(kitchenStatus, id, ...ROLLUP_STATIONS);
      }
      if (paymentStatus !== undefined) {
        db.prepare('UPDATE orders SET payment_status = ? WHERE id = ?').run(paymentStatus, id);
      }
      if (kitchenStatus !== undefined) {
        recomputeOrderKitchenStatus(id);
      }
    })();

    res.json(serialize(getOrder.get(id)));
  });

  // Station-aware advance — only that order's items matching `station` move,
  // so a bar-side advance on a mixed food+drink order doesn't touch the
  // kitchen's items (and vice versa). Feeds the rollup the same as above.
  router.patch('/:id/station-status', requireAuth, (req, res) => {
    const id = Number(req.params.id);
    const existing = getOrder.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'order not found' });
    }

    const { station, status } = req.body ?? {};
    if (!ROLLUP_STATIONS.includes(station)) {
      return res.status(400).json({ error: `station must be one of: ${ROLLUP_STATIONS.join(', ')}` });
    }
    if (!VALID_KITCHEN_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_KITCHEN_STATUSES.join(', ')}` });
    }

    db.transaction(() => {
      setStationItemStatus.run(status, id, station);
      recomputeOrderKitchenStatus(id);
    })();

    res.json(serialize(getOrder.get(id)));
  });

  // Per-line void/comp/discount, manager-PIN-authorized. A void additionally
  // reverses that item's recipe-driven stock deduction and marks it
  // 'completed' so it drops off any active kitchen/bar display — the item
  // isn't deleted (it stays on the historical ticket/receipt), just no
  // longer something staff need to act on.
  router.post('/:id/items/:itemId/adjustments', requireAuth, (req, res) => {
    const orderId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const item = getOrderItemForOrder.get(itemId, orderId);
    if (!item) {
      return res.status(404).json({ error: 'order item not found on this order' });
    }

    const { type, amount: amountRaw, reason } = req.body ?? {};
    if (!VALID_ADJUSTMENT_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}` });
    }
    const lineTotal = item.unit_price * item.quantity;
    const amount = amountRaw === undefined ? lineTotal : Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const alreadyAdjusted = sumItemAdjustments.get(itemId).total;
    if (alreadyAdjusted + amount > lineTotal + 0.01) {
      return res
        .status(400)
        .json({ error: `amount exceeds this line's remaining adjustable total ($${(lineTotal - alreadyAdjusted).toFixed(2)})` });
    }

    const manager = resolveManagerApproval(req, res);
    if (!manager) return;

    db.transaction(() => {
      insertItemAdjustment.run(
        itemId,
        type,
        amount,
        typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null,
        manager.id,
        req.user.id
      );
      if (type === 'void') {
        for (const line of getRecipeLines.all(item.menu_item_id)) {
          incrementStock.run(line.quantity_required * item.quantity, line.ingredient_id);
        }
        setItemStatusById.run('completed', itemId);
        recomputeOrderKitchenStatus(orderId);
      }
    })();

    res.status(201).json({ order: serialize(getOrder.get(orderId)), adjustments: listItemAdjustments.all(itemId) });
  });

  // Whole-check void/comp/discount (e.g. "10% off the table"), same
  // manager-PIN authorization as the per-item endpoint above.
  router.post('/:id/adjustments', requireAuth, (req, res) => {
    const orderId = Number(req.params.id);
    const order = getOrder.get(orderId);
    if (!order) {
      return res.status(404).json({ error: 'order not found' });
    }

    const { type, amount: amountRaw, reason } = req.body ?? {};
    if (!VALID_ADJUSTMENT_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of: ${VALID_ADJUSTMENT_TYPES.join(', ')}` });
    }
    const amount = amountRaw === undefined ? order.total : Number(amountRaw);
    if (!Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    const alreadyAdjusted = sumOrderAdjustments.get(orderId).total;
    if (alreadyAdjusted + amount > order.total + 0.01) {
      return res
        .status(400)
        .json({ error: `amount exceeds this order's remaining adjustable total ($${(order.total - alreadyAdjusted).toFixed(2)})` });
    }

    const manager = resolveManagerApproval(req, res);
    if (!manager) return;

    db.transaction(() => {
      insertOrderAdjustment.run(
        orderId,
        type,
        amount,
        typeof reason === 'string' && reason.trim() !== '' ? reason.trim() : null,
        manager.id,
        req.user.id
      );
      if (type === 'void') {
        // Mirrors the per-item void's stock reversal, applied to every item
        // on the order, and rolls every item's status to 'completed' so
        // nothing lingers on an active kitchen/bar display.
        for (const orderItem of listOrderItems.all(orderId)) {
          for (const line of getRecipeLines.all(orderItem.menu_item_id)) {
            incrementStock.run(line.quantity_required * orderItem.quantity, line.ingredient_id);
          }
          setItemStatusById.run('completed', orderItem.id);
        }
        recomputeOrderKitchenStatus(orderId);
      }
    })();

    res.status(201).json({ order: serialize(getOrder.get(orderId)), adjustments: listOrderAdjustmentsFor.all(orderId) });
  });

  return router;
}

module.exports = { createOrdersRouter };
