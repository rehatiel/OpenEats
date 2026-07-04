const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { createOrderTotalsHelper } = require('../lib/orderTotals');

const VALID_TENDER_TYPES = ['cash', 'card', 'split'];

// Every payment collected toward a table's tab goes through here — whether
// it's the whole table tendered at once (guest_label 'Table') or one
// guest's share of a split bill — so there is exactly one place that
// decides "has this table's tab been fully paid yet," instead of a
// separate whole-table code path that could double-charge on top of
// already-collected split payments.
function createGuestPaymentsRouter(db) {
  const router = express.Router();
  const { computeNetTotals } = createOrderTotalsHelper(db);

  const insertPayment = db.prepare(`
    INSERT INTO guest_payments
      (table_identifier, order_ids, guest_label, subtotal, tax, total, tender_type, tendered_amount, items_summary,
       tip_amount, cash_amount, card_amount, cc_fee_amount, server_user_id, server_name)
    VALUES (@table_identifier, @order_ids, @guest_label, @subtotal, @tax, @total, @tender_type, @tendered_amount, @items_summary,
       @tip_amount, @cash_amount, @card_amount, @cc_fee_amount, @server_user_id, @server_name)
  `);
  const listByTable = db.prepare('SELECT * FROM guest_payments WHERE table_identifier = ? ORDER BY paid_at');
  const getPayment = db.prepare('SELECT * FROM guest_payments WHERE id = ?');
  const markPaid = db.prepare("UPDATE orders SET payment_status = 'paid' WHERE id = ?");
  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  const findUserByName = db.prepare('SELECT id FROM users WHERE name = ? AND active = 1');

  function getOrdersByIds(ids) {
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    return db
      .prepare(`SELECT id, subtotal, tax, total, payment_status, server_name FROM orders WHERE id IN (${placeholders})`)
      .all(...ids);
  }

  // Sum of guest_payments already recorded toward any of these order_ids —
  // the same "already collected toward these specific orders" definition
  // used below to decide `settled`, computed here up front so a payment
  // can't be accepted for more than what's actually still owed.
  function collectedTowardOrders(tableIdentifier, orderIds) {
    return listByTable
      .all(tableIdentifier)
      .filter((row) => JSON.parse(row.order_ids).some((id) => orderIds.includes(id)))
      .reduce((sum, row) => sum + row.total, 0);
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
      tip_amount: tipAmountRaw,
      cash_amount: cashAmountRaw,
      card_amount: cardAmountRaw,
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

    const tipAmount = tipAmountRaw === undefined ? 0 : Number(tipAmountRaw);
    if (!Number.isFinite(tipAmount) || tipAmount < 0) {
      return res.status(400).json({ error: 'tip_amount must be a non-negative number' });
    }
    if (tipAmount > 0 && getSetting.get('accept_tips')?.value !== '1') {
      return res.status(400).json({ error: 'tips are not enabled' });
    }

    // cash/card split of the bill amount (not tip, not the card fee) — for
    // a pure cash or card tender the client still supplies both, one of
    // them zero, so split payments and single-tender payments share one
    // code path. Together they must cover this payment's `total` (the
    // portion of the tab this specific payment settles).
    const cashAmount = cashAmountRaw === undefined ? (tenderType === 'cash' ? total : 0) : Number(cashAmountRaw);
    const cardAmount = cardAmountRaw === undefined ? (tenderType === 'card' ? total : 0) : Number(cardAmountRaw);
    if (![cashAmount, cardAmount].every((n) => Number.isFinite(n) && n >= 0)) {
      return res.status(400).json({ error: 'cash_amount and card_amount must be non-negative numbers' });
    }
    if (Math.abs(cashAmount + cardAmount - total) > 0.01) {
      return res.status(400).json({ error: 'cash_amount + card_amount must equal total' });
    }

    // Computed server-side from the current setting, not trusted from the
    // client, so a stale/tampered fee display can't under- or over-charge
    // what's recorded — mirrors how orders.js computes tax at request time.
    const ccFeePercent = Number(getSetting.get('cc_fee_percent')?.value ?? 0);
    const ccFeeAmount = cardAmount * ccFeePercent;

    if (tenderedAmount < total + tipAmount + ccFeeAmount - 0.005) {
      return res.status(400).json({ error: 'tendered_amount must cover the total plus tip and card fee' });
    }

    const orders = getOrdersByIds(orderIds);
    if (orders.length !== orderIds.length) {
      return res.status(400).json({ error: 'one or more order_ids do not exist' });
    }
    if (orders.some((o) => o.payment_status === 'paid')) {
      return res.status(400).json({ error: 'one or more of these orders is already paid' });
    }

    // What's actually left to collect on these orders once voids/comps/
    // discounts are netted out — computed server-side (not trusted from the
    // client's `total`) so a manager-authorized adjustment can't be silently
    // bypassed by charging the guest the pre-adjustment amount.
    const owedTotal = orders.reduce((sum, o) => sum + computeNetTotals(o).net_total, 0);
    const alreadyCollectedForOrders = collectedTowardOrders(tableIdentifier, orderIds);
    const remainingOwed = Math.max(0, owedTotal - alreadyCollectedForOrders);
    if (total > remainingOwed + 0.02) {
      return res
        .status(400)
        .json({ error: `total exceeds the remaining amount owed on these orders ($${remainingOwed.toFixed(2)})` });
    }

    // The server who gets credit for the tip is whoever served the table,
    // not whoever happens to be running the register — snapshot both a
    // display name (survives a later rename) and a durable user id where
    // resolvable.
    const serverName = orders[0]?.server_name ?? null;
    const serverUserId = serverName ? findUserByName.get(serverName)?.id ?? null : null;

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
        tip_amount: tipAmount,
        cash_amount: cashAmount,
        card_amount: cardAmount,
        cc_fee_amount: ccFeeAmount,
        server_user_id: serverUserId,
        server_name: serverName,
      });

      // "Already collected toward these specific orders" — only payments
      // whose order_ids set intersects this one count, so a reused table
      // label doesn't inherit a prior visit's payments. Compared against the
      // net (post-adjustment) total, not the gross one, so a table with a
      // comped item settles once the reduced amount is actually collected.
      const collected = collectedTowardOrders(tableIdentifier, orderIds);
      const settled = collected >= owedTotal - 0.01;
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
