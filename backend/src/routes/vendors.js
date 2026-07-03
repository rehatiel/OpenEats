const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

function createVendorsRouter(db) {
  const router = express.Router();

  const listVendors = db.prepare('SELECT * FROM vendors WHERE active = 1 ORDER BY name');
  const getVendor = db.prepare('SELECT * FROM vendors WHERE id = ?');
  const insertVendor = db.prepare(`
    INSERT INTO vendors (name, contact_name, phone, email, notes, active)
    VALUES (@name, @contact_name, @phone, @email, @notes, 1)
  `);

  function parseVendorBody(body, existing) {
    const str = (value, fallback) => (typeof value === 'string' ? value.trim() : fallback);
    return {
      name: typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : existing?.name,
      contact_name: str(body.contact_name, existing?.contact_name ?? null) || null,
      phone: str(body.phone, existing?.phone ?? null) || null,
      email: str(body.email, existing?.email ?? null) || null,
      notes: str(body.notes, existing?.notes ?? null) || null,
    };
  }

  // Any authenticated role can read — purchase order creation needs the list.
  router.get('/', requireAuth, (_req, res) => {
    res.json(listVendors.all());
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const body = parseVendorBody(req.body ?? {}, null);
    if (!body.name) {
      return res.status(400).json({ error: 'name is required' });
    }
    const { lastInsertRowid } = insertVendor.run(body);
    res.status(201).json(getVendor.get(lastInsertRowid));
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getVendor.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'vendor not found' });
    }
    const next = parseVendorBody(req.body ?? {}, existing);
    db.prepare('UPDATE vendors SET name = ?, contact_name = ?, phone = ?, email = ?, notes = ? WHERE id = ?').run(
      next.name,
      next.contact_name,
      next.phone,
      next.email,
      next.notes,
      id
    );
    res.json(getVendor.get(id));
  });

  // Soft delete only — a purchase_orders row may still reference this vendor.
  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getVendor.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'vendor not found' });
    }
    db.prepare('UPDATE vendors SET active = 0 WHERE id = ?').run(id);
    res.json({ ...existing, active: 0 });
  });

  return router;
}

module.exports = { createVendorsRouter };
