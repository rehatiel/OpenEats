const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

function createIngredientsRouter(db) {
  const router = express.Router();

  const listIngredients = db.prepare('SELECT * FROM ingredients WHERE active = 1 ORDER BY name');
  const getIngredient = db.prepare('SELECT * FROM ingredients WHERE id = ?');
  const insertIngredient = db.prepare(`
    INSERT INTO ingredients (name, unit, current_stock, unit_cost, reorder_threshold, reorder_quantity, active)
    VALUES (@name, @unit, @current_stock, @unit_cost, @reorder_threshold, @reorder_quantity, 1)
  `);
  // Registered before /:id so "restock-list" isn't swallowed as an :id.
  const listRestock = db.prepare(
    'SELECT * FROM ingredients WHERE active = 1 AND current_stock <= reorder_threshold ORDER BY (current_stock - reorder_threshold)'
  );

  function parseIngredientBody(body, existing) {
    const name = typeof body.name === 'string' && body.name.trim() !== '' ? body.name.trim() : existing?.name;
    const unit = typeof body.unit === 'string' && body.unit.trim() !== '' ? body.unit.trim() : existing?.unit;
    const numOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback);
    return {
      name,
      unit,
      current_stock: numOr(body.current_stock, existing?.current_stock ?? 0),
      unit_cost: numOr(body.unit_cost, existing?.unit_cost ?? 0),
      reorder_threshold: numOr(body.reorder_threshold, existing?.reorder_threshold ?? 0),
      reorder_quantity: numOr(body.reorder_quantity, existing?.reorder_quantity ?? 0),
    };
  }

  // Any authenticated role can read — the Dashboard's low-stock card needs it
  // for admin and manager alike, and the menu recipe editor needs it too.
  router.get('/', requireAuth, (_req, res) => {
    res.json(listIngredients.all());
  });

  router.get('/restock-list', requireAuth, (_req, res) => {
    res.json(listRestock.all());
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const body = parseIngredientBody(req.body ?? {}, null);
    if (!body.name || !body.unit) {
      return res.status(400).json({ error: 'name and unit are required' });
    }
    const { lastInsertRowid } = insertIngredient.run(body);
    res.status(201).json(getIngredient.get(lastInsertRowid));
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getIngredient.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'ingredient not found' });
    }
    const next = parseIngredientBody(req.body ?? {}, existing);
    db.prepare(
      `UPDATE ingredients
       SET name = ?, unit = ?, current_stock = ?, unit_cost = ?, reorder_threshold = ?, reorder_quantity = ?
       WHERE id = ?`
    ).run(next.name, next.unit, next.current_stock, next.unit_cost, next.reorder_threshold, next.reorder_quantity, id);
    res.json(getIngredient.get(id));
  });

  // Soft delete only — a recipe_items or purchase_order_items row may still
  // reference this ingredient.
  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getIngredient.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'ingredient not found' });
    }
    db.prepare('UPDATE ingredients SET active = 0 WHERE id = ?').run(id);
    res.json({ ...existing, active: 0 });
  });

  return router;
}

module.exports = { createIngredientsRouter };
