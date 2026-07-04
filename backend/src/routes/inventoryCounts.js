const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

// A physical count session reconciles ingredients.current_stock to what's
// actually on the shelf — the system's running total drifts over time
// (spillage, over-pours, uncounted waste) and this is the only mechanism
// that corrects it back to reality. Feeds the COGS & Inventory Variance
// report.
function createInventoryCountsRouter(db) {
  const router = express.Router();

  const getIngredient = db.prepare('SELECT id, current_stock, unit FROM ingredients WHERE id = ?');
  const insertCount = db.prepare('INSERT INTO physical_inventory_counts (counted_by_user_id, notes) VALUES (?, ?)');
  const insertLine = db.prepare(`
    INSERT INTO physical_inventory_count_lines (count_id, ingredient_id, counted_quantity, expected_quantity, variance)
    VALUES (?, ?, ?, ?, ?)
  `);
  const setStock = db.prepare('UPDATE ingredients SET current_stock = ? WHERE id = ?');
  const getCount = db.prepare('SELECT * FROM physical_inventory_counts WHERE id = ?');
  const listCounts = db.prepare('SELECT * FROM physical_inventory_counts ORDER BY counted_at DESC');
  const listLinesFor = db.prepare(`
    SELECT picl.*, i.name, i.unit
    FROM physical_inventory_count_lines picl
    JOIN ingredients i ON i.id = picl.ingredient_id
    WHERE picl.count_id = ?
  `);

  function serialize(count) {
    return { ...count, lines: listLinesFor.all(count.id) };
  }

  router.get('/', requireAuth, (_req, res) => {
    res.json(listCounts.all().map(serialize));
  });

  router.get('/:id', requireAuth, (req, res) => {
    const count = getCount.get(Number(req.params.id));
    if (!count) {
      return res.status(404).json({ error: 'inventory count not found' });
    }
    res.json(serialize(count));
  });

  // One call records the whole count and immediately corrects
  // ingredients.current_stock to what was actually counted — there is no
  // separate "apply" step.
  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { notes, lines } = req.body ?? {};
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'lines must be a non-empty array' });
    }
    for (const line of lines) {
      const ingredient = getIngredient.get(line.ingredient_id);
      if (!ingredient) {
        return res.status(400).json({ error: `unknown ingredient_id ${line.ingredient_id}` });
      }
      if (typeof line.counted_quantity !== 'number' || !Number.isFinite(line.counted_quantity) || line.counted_quantity < 0) {
        return res.status(400).json({ error: `counted_quantity for ingredient ${line.ingredient_id} must be a non-negative number` });
      }
    }

    const id = db.transaction(() => {
      const { lastInsertRowid } = insertCount.run(req.user.id, typeof notes === 'string' ? notes.trim() || null : null);
      for (const line of lines) {
        const ingredient = getIngredient.get(line.ingredient_id);
        const expected = ingredient.current_stock;
        insertLine.run(lastInsertRowid, line.ingredient_id, line.counted_quantity, expected, line.counted_quantity - expected);
        setStock.run(line.counted_quantity, line.ingredient_id);
      }
      return lastInsertRowid;
    })();

    res.status(201).json(serialize(getCount.get(id)));
  });

  return router;
}

module.exports = { createInventoryCountsRouter };
