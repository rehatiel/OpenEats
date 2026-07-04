const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_STATUSES = ['open', 'paid'];

// Vendor invoices are independent of purchase_orders' order/receive
// lifecycle (a PO can exist with no invoice yet, or an invoice can arrive
// with no PO on file) — purchase_order_id is an optional cross-reference,
// not a requirement.
function createVendorInvoicesRouter(db) {
  const router = express.Router();

  const getVendor = db.prepare('SELECT id FROM vendors WHERE id = ?');
  const getPO = db.prepare('SELECT id FROM purchase_orders WHERE id = ?');
  const insertInvoice = db.prepare(`
    INSERT INTO vendor_invoices (vendor_id, purchase_order_id, invoice_number, invoice_date, due_date, amount, notes)
    VALUES (@vendor_id, @purchase_order_id, @invoice_number, @invoice_date, @due_date, @amount, @notes)
  `);
  const getInvoice = db.prepare('SELECT * FROM vendor_invoices WHERE id = ?');
  const listInvoices = db.prepare(`
    SELECT vi.*, v.name AS vendor_name
    FROM vendor_invoices vi
    JOIN vendors v ON v.id = vi.vendor_id
    ORDER BY vi.due_date
  `);

  // 'overdue' is never stored — it's derived here from due_date so it can't
  // drift from reality without a background job. due_date is a plain
  // YYYY-MM-DD date (no time component); comparing against today's date
  // (also truncated) means an invoice due today isn't yet counted as
  // overdue.
  function serialize(invoice) {
    const today = new Date().toISOString().slice(0, 10);
    const isOverdue = invoice.status === 'open' && invoice.due_date < today;
    return { ...invoice, is_overdue: isOverdue };
  }

  router.get('/', requireAuth, (_req, res) => {
    res.json(listInvoices.all().map(serialize));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const invoice = getInvoice.get(Number(req.params.id));
    if (!invoice) {
      return res.status(404).json({ error: 'vendor invoice not found' });
    }
    res.json(serialize(invoice));
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const {
      vendor_id: vendorId,
      purchase_order_id: purchaseOrderId,
      invoice_number: invoiceNumber,
      invoice_date: invoiceDate,
      due_date: dueDate,
      amount,
      notes,
    } = req.body ?? {};

    if (!getVendor.get(vendorId)) {
      return res.status(400).json({ error: 'vendor_id is required and must reference an existing vendor' });
    }
    if (purchaseOrderId !== undefined && purchaseOrderId !== null && !getPO.get(purchaseOrderId)) {
      return res.status(400).json({ error: 'purchase_order_id must reference an existing purchase order' });
    }
    if (typeof invoiceDate !== 'string' || invoiceDate.trim() === '') {
      return res.status(400).json({ error: 'invoice_date is required' });
    }
    if (typeof dueDate !== 'string' || dueDate.trim() === '') {
      return res.status(400).json({ error: 'due_date is required' });
    }
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const { lastInsertRowid } = insertInvoice.run({
      vendor_id: vendorId,
      purchase_order_id: purchaseOrderId ?? null,
      invoice_number: typeof invoiceNumber === 'string' ? invoiceNumber.trim() || null : null,
      invoice_date: invoiceDate,
      due_date: dueDate,
      amount,
      notes: typeof notes === 'string' ? notes.trim() || null : null,
    });
    res.status(201).json(serialize(getInvoice.get(lastInsertRowid)));
  });

  router.patch('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getInvoice.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'vendor invoice not found' });
    }

    const { status, notes } = req.body ?? {};
    if (status !== undefined && !VALID_STATUSES.includes(status)) {
      return res.status(400).json({ error: `status must be one of: ${VALID_STATUSES.join(', ')}` });
    }

    const nextStatus = status ?? existing.status;
    const nextPaidDate = nextStatus === 'paid' ? (existing.paid_date ?? new Date().toISOString()) : null;

    db.prepare('UPDATE vendor_invoices SET status = ?, paid_date = ?, notes = ? WHERE id = ?').run(
      nextStatus,
      nextPaidDate,
      typeof notes === 'string' ? notes.trim() || null : existing.notes,
      id
    );
    res.json(serialize(getInvoice.get(id)));
  });

  return router;
}

module.exports = { createVendorInvoicesRouter };
