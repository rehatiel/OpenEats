const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

function createPurchaseOrdersRouter(db) {
  const router = express.Router();

  const getVendor = db.prepare('SELECT id, name FROM vendors WHERE id = ?');
  const getIngredient = db.prepare('SELECT id, name, unit FROM ingredients WHERE id = ?');
  const insertPO = db.prepare(`
    INSERT INTO purchase_orders (vendor_id, order_number, tracking_number, notes)
    VALUES (@vendor_id, @order_number, @tracking_number, @notes)
  `);
  const insertPOItem = db.prepare(`
    INSERT INTO purchase_order_items (purchase_order_id, ingredient_id, quantity, unit_price_paid)
    VALUES (?, ?, ?, ?)
  `);
  const getPO = db.prepare('SELECT * FROM purchase_orders WHERE id = ?');
  const listPOs = db.prepare(`
    SELECT po.*, v.name AS vendor_name
    FROM purchase_orders po
    JOIN vendors v ON v.id = po.vendor_id
    ORDER BY po.created_at DESC
  `);
  const listPOItems = db.prepare(`
    SELECT poi.id, poi.ingredient_id, poi.quantity, poi.unit_price_paid, i.name, i.unit
    FROM purchase_order_items poi
    JOIN ingredients i ON i.id = poi.ingredient_id
    WHERE poi.purchase_order_id = ?
  `);
  const receiveStock = db.prepare('UPDATE ingredients SET current_stock = current_stock + ?, unit_cost = ? WHERE id = ?');
  const markReceived = db.prepare(
    "UPDATE purchase_orders SET status = 'received', received_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
  );

  function serialize(po) {
    const items = listPOItems.all(po.id);
    const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price_paid, 0);
    return { ...po, items, total };
  }

  router.get('/', requireAuth, (_req, res) => {
    res.json(listPOs.all().map(serialize));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const po = getPO.get(Number(req.params.id));
    if (!po) {
      return res.status(404).json({ error: 'purchase order not found' });
    }
    res.json(serialize(po));
  });

  // Created "ordered" immediately — there's no draft stage, matching how
  // orders elsewhere in this app are created complete rather than staged.
  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { vendor_id: vendorId, order_number: orderNumber, tracking_number: trackingNumber, notes, items } = req.body ?? {};
    if (!getVendor.get(vendorId)) {
      return res.status(400).json({ error: 'vendor_id is required and must reference an existing vendor' });
    }
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items must be a non-empty array' });
    }
    for (const item of items) {
      if (!getIngredient.get(item.ingredient_id)) {
        return res.status(400).json({ error: `unknown ingredient_id ${item.ingredient_id}` });
      }
      if (typeof item.quantity !== 'number' || item.quantity <= 0) {
        return res.status(400).json({ error: 'each item quantity must be a positive number' });
      }
    }

    const create = db.transaction(() => {
      const { lastInsertRowid } = insertPO.run({
        vendor_id: vendorId,
        order_number: typeof orderNumber === 'string' ? orderNumber.trim() || null : null,
        tracking_number: typeof trackingNumber === 'string' ? trackingNumber.trim() || null : null,
        notes: typeof notes === 'string' ? notes.trim() || null : null,
      });
      for (const item of items) {
        insertPOItem.run(lastInsertRowid, item.ingredient_id, item.quantity, Number(item.unit_price_paid) || 0);
      }
      return lastInsertRowid;
    });

    const id = create();
    res.status(201).json(serialize(getPO.get(id)));
  });

  router.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getPO.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'purchase order not found' });
    }

    const { order_number: orderNumber, tracking_number: trackingNumber, notes, status } = req.body ?? {};

    if (status !== undefined && status !== existing.status) {
      if (status === 'received') {
        if (existing.status !== 'ordered') {
          return res.status(400).json({ error: `cannot receive a purchase order with status ${existing.status}` });
        }
        const receive = db.transaction(() => {
          for (const item of listPOItems.all(id)) {
            receiveStock.run(item.quantity, item.unit_price_paid, item.ingredient_id);
          }
          markReceived.run(id);
        });
        receive();
      } else if (status === 'cancelled') {
        db.prepare("UPDATE purchase_orders SET status = 'cancelled' WHERE id = ?").run(id);
      } else {
        return res.status(400).json({ error: `invalid status transition to ${status}` });
      }
    }

    const fresh = getPO.get(id);
    db.prepare('UPDATE purchase_orders SET order_number = ?, tracking_number = ?, notes = ? WHERE id = ?').run(
      typeof orderNumber === 'string' ? orderNumber.trim() || null : fresh.order_number,
      typeof trackingNumber === 'string' ? trackingNumber.trim() || null : fresh.tracking_number,
      typeof notes === 'string' ? notes.trim() || null : fresh.notes,
      id
    );

    res.json(serialize(getPO.get(id)));
  });

  return router;
}

module.exports = { createPurchaseOrdersRouter };
