const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { createLedgerHelper } = require('../lib/ledger');

// Long-lived asset purchases (kitchen equipment, renovations, software
// platforms) — a simple append-only log for now (no edit/delete, matching
// how other financial records in this app aren't mutated after the fact);
// feeds the CapEx Log report and, later, depreciation in the P&L/Balance
// Sheet.
function createCapexRouter(db) {
  const router = express.Router();
  const { postCapexCreated } = createLedgerHelper(db);

  const getVendor = db.prepare('SELECT id FROM vendors WHERE id = ?');
  const insertItem = db.prepare(`
    INSERT INTO capex_items (description, category, purchase_date, amount, vendor_id, useful_life_months, notes)
    VALUES (@description, @category, @purchase_date, @amount, @vendor_id, @useful_life_months, @notes)
  `);
  const getItem = db.prepare('SELECT * FROM capex_items WHERE id = ?');
  const listItems = db.prepare(`
    SELECT ci.*, v.name AS vendor_name
    FROM capex_items ci
    LEFT JOIN vendors v ON v.id = ci.vendor_id
    ORDER BY ci.purchase_date DESC
  `);

  router.get('/', requireAuth, (_req, res) => {
    res.json(listItems.all());
  });

  router.get('/:id', requireAuth, (req, res) => {
    const item = getItem.get(Number(req.params.id));
    if (!item) {
      return res.status(404).json({ error: 'capex item not found' });
    }
    res.json(item);
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const {
      description,
      category,
      purchase_date: purchaseDate,
      amount,
      vendor_id: vendorId,
      useful_life_months: usefulLifeMonths,
      notes,
    } = req.body ?? {};

    if (typeof description !== 'string' || description.trim() === '') {
      return res.status(400).json({ error: 'description is required' });
    }
    if (typeof purchaseDate !== 'string' || purchaseDate.trim() === '') {
      return res.status(400).json({ error: 'purchase_date is required' });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (vendorId !== undefined && vendorId !== null && !getVendor.get(vendorId)) {
      return res.status(400).json({ error: 'vendor_id must reference an existing vendor' });
    }
    if (usefulLifeMonths !== undefined && usefulLifeMonths !== null && (!Number.isInteger(usefulLifeMonths) || usefulLifeMonths <= 0)) {
      return res.status(400).json({ error: 'useful_life_months must be a positive integer' });
    }

    const { lastInsertRowid } = insertItem.run({
      description: description.trim(),
      category: typeof category === 'string' ? category.trim() || null : null,
      purchase_date: purchaseDate,
      amount,
      vendor_id: vendorId ?? null,
      useful_life_months: usefulLifeMonths ?? null,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
    });
    const item = getItem.get(lastInsertRowid);
    postCapexCreated(item);
    res.status(201).json(item);
  });

  return router;
}

module.exports = { createCapexRouter };
