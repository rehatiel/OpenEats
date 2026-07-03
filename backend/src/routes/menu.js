const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

function createMenuRouter(db) {
  const router = express.Router();

  const listMenuItems = db.prepare(
    'SELECT id, name, category, retail_price, active FROM menu_items WHERE active = 1 ORDER BY category, name'
  );
  const getMenuItem = db.prepare('SELECT id, name, category, retail_price, active FROM menu_items WHERE id = ?');
  const insertMenuItem = db.prepare(
    'INSERT INTO menu_items (name, category, retail_price, active) VALUES (?, ?, ?, 1)'
  );

  // Any authenticated role can read the menu — Order Entry needs it.
  router.get('/', requireAuth, (_req, res) => {
    res.json(listMenuItems.all());
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { name, category, retail_price: retailPrice } = req.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (typeof category !== 'string' || category.trim() === '') {
      return res.status(400).json({ error: 'category is required' });
    }
    if (typeof retailPrice !== 'number' || !Number.isFinite(retailPrice) || retailPrice < 0) {
      return res.status(400).json({ error: 'retail_price must be a non-negative number' });
    }

    const { lastInsertRowid } = insertMenuItem.run(name.trim(), category.trim(), retailPrice);
    res.status(201).json(getMenuItem.get(lastInsertRowid));
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getMenuItem.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'menu item not found' });
    }

    const { name, category, retail_price: retailPrice, active } = req.body ?? {};
    const next = {
      name: typeof name === 'string' && name.trim() !== '' ? name.trim() : existing.name,
      category: typeof category === 'string' && category.trim() !== '' ? category.trim() : existing.category,
      retail_price:
        typeof retailPrice === 'number' && Number.isFinite(retailPrice) && retailPrice >= 0
          ? retailPrice
          : existing.retail_price,
      active: active !== undefined ? (active ? 1 : 0) : existing.active,
    };

    db.prepare('UPDATE menu_items SET name = ?, category = ?, retail_price = ?, active = ? WHERE id = ?').run(
      next.name,
      next.category,
      next.retail_price,
      next.active,
      id
    );
    res.json(getMenuItem.get(id));
  });

  // Soft delete only — an order_items row may still reference this item.
  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getMenuItem.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'menu item not found' });
    }
    db.prepare('UPDATE menu_items SET active = 0 WHERE id = ?').run(id);
    res.json({ ...existing, active: 0 });
  });

  return router;
}

module.exports = { createMenuRouter };
