const express = require('express');
const { requireAuth } = require('../middleware/auth');

const VALID_TENDER_TYPES = ['cash', 'card', 'split'];

// Every payment collected toward a table's tab goes through here — whether
// it's the whole table tendered at once (guest_label 'Table') or one
// guest's share of a split bill — so there is exactly one place that
// decides "has this table's tab been fully paid yet," instead of a
// separate whole-table code path that could double-charge on top of
// already-collected split payments.
function createGuestPaymentsRouter(db) {
  const router = express.Router();

  const insertPayment = db.prepare(`
    INSERT INTO guest_payments
      (table_identifier, order_ids, guest_label, subtotal, tax, total, tender_type, tendered_amount, items_summary)
    VALUES (@table_identifier, @order_ids, @guest_label, @subtotal, @tax, @total, @tender_type, @tendered_amount, @items_summary)
  `);
  const listByTable = db.prepare('SELECT * FROM guest_payments WHERE table_identifier = ? ORDER BY paid_at');
  const getPayment = db.prepare('SELECT * FROM guest_payments WHERE id = ?');
  const markPaid = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?");

  function getOrdersByIds(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return db.prepare(`SELECT id, total, payment_status FROM orders WHERE id IN (${placeholders})`).all(...ids);
  }

  function deserialize(row) {
    return { ...row, order_ids: JSON.parse(row.order_ids), items_summary: JSON.parse(row.items_summary) };
  }

  router.get('/', requireAuth, (req, res) => {
    const { table_identifier: tableIdentifier } = req.query;
    if (typeof tableIdentifier !== 'string' || tableIdentifier.trim() === '') {
      return res.status(400).json({ error: 'table_identifier is required' });
    }
    res.json(listByTable.all(tableIdentifier).map(deserialize));
  });

  router.post('/', requireAuth, (req, res) => {
    const {
      table_identifier: tableIdentifier,
      order_ids: orderIds,
      guest_label: guestLabel,
      subtotal,
      tax,
      total,
      tender_type: tenderType,
      tendered_amount: tenderedAmount,
      items_summary: itemsSummary,
    } = req.body ?? {};

    if (typeof tableIdentifier !== 'string' || tableIdentifier.trim() === '') {
      return res.status(400).json({ error: 'table_identifier is required' });
    }
    if (!Array.isArray(orderIds) || orderIds.length === 0 || !orderIds.every((id) => Number.isInteger(id))) {
      return res.status(400).json({ error: 'order_ids must be a non-empty array of order ids' });
    }
    if (typeof guestLabel !== 'string' || guestLabel.trim() === '') {
      return res.status(400).json({ error: 'guest_label is required' });
    }
    if (![subtotal, tax, total, tenderedAmount].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({ error: 'subtotal, tax, total, and tendered_amount must be non-negative numbers' });
    }
    if (!VALID_TENDER_TYPES.includes(tenderType)) {
      return res.status(400).json({ error: `tender_type must be one of: ${VALID_TENDER_TYPES.join(', ')}` });
    }
    if (tenderedAmount < total - 0.005) {
      return res.status(400).json({ error: 'tendered_amount must cover the total' });
    }

    const orders = getOrdersByIds(orderIds);
    if (orders.length !== orderIds.length) {
      return res.status(400).json({ error: 'one or more order_ids do not exist' });
    }
    if (orders.some((o) => o.payment_status === 'paid')) {
      return res.status(400).json({ error: 'one or more of these orders is already paid' });
    }

    const result = db.transaction(() => {
      const { lastInsertRowid } = insertPayment.run({
        table_identifier: tableIdentifier,
        order_ids: JSON.stringify(orderIds),
        guest_label: guestLabel.trim(),
        subtotal,
        tax,
        total,
        tender_type: tenderType,
        tendered_amount: tenderedAmount,
        items_summary: JSON.stringify(itemsSummary ?? []),
      });

      // "Already collected toward these specific orders" — only payments
      // whose order_ids set intersects this one count, so a reused table
      // label doesn't inherit a prior visit's payments.
      const collected = listByTable
        .all(tableIdentifier)
        .filter((row) => JSON.parse(row.order_ids).some((id) => orderIds.includes(id)))
        .reduce((sum, row) => sum + row.total, 0);
      const owed = orders.reduce((sum, o) => sum + o.total, 0);

      const settled = collected >= owed - 0.01;
      if (settled) {
        for (const id of orderIds) markPaid.run(id);
      }

      return { paymentId: lastInsertRowid, settled };
    })();

    res.status(201).json({ payment: deserialize(getPayment.get(result.paymentId)), settled: result.settled });
  });

  return router;
}

module.exports = { createGuestPaymentsRouter };
