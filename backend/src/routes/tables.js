const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_SHAPES = ['square', 'round'];

function createTablesRouter(db) {
  const router = express.Router();

  const listTables = db.prepare('SELECT * FROM tables WHERE active = 1 ORDER BY sort_order');
  const getTable = db.prepare('SELECT * FROM tables WHERE id = ?');
  const insertTable = db.prepare(`
    INSERT INTO tables (label, seats, shape, pos_x, pos_y, width, height, sort_order, active)
    VALUES (@label, @seats, @shape, @pos_x, @pos_y, @width, @height, @sort_order, 1)
  `);
  const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tables');
  const updateTableRow = db.prepare(
    'UPDATE tables SET label = ?, seats = ?, shape = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, sort_order = ? WHERE id = ?'
  );

  // Any authenticated role can read the layout — every POS screen needs it.
  router.get('/', requireAuth, (_req, res) => {
    res.json(listTables.all());
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { label, seats, shape } = req.body ?? {};
    if (typeof label !== 'string' || label.trim() === '') {
      return res.status(400).json({ error: 'label is required' });
    }
    if (!Number.isInteger(seats) || seats <= 0) {
      return res.status(400).json({ error: 'seats must be a positive integer' });
    }
    const resolvedShape = VALID_SHAPES.includes(shape) ? shape : 'square';
    const size = resolvedShape === 'round' ? 150 : 112;

    const { lastInsertRowid } = insertTable.run({
      label: label.trim(),
      seats,
      shape: resolvedShape,
      pos_x: 48,
      pos_y: 48,
      width: size,
      height: size,
      sort_order: nextSortOrder.get().n,
    });
    res.status(201).json(getTable.get(lastInsertRowid));
  });

  // Bulk position save — the drag-and-drop layout editor's single Save
  // action, applied atomically so a partial failure can't leave the layout
  // half-moved.
  router.put('/', requireAuth, requireRole('admin'), (req, res) => {
    const { tables } = req.body ?? {};
    if (!Array.isArray(tables)) {
      return res.status(400).json({ error: 'tables must be an array' });
    }

    const applyAll = db.transaction((rows) => {
      for (const row of rows) {
        const existing = getTable.get(row.id);
        if (!existing) throw new Error(`table ${row.id} does not exist`);
        updateTableRow.run(
          row.label ?? existing.label,
          row.seats ?? existing.seats,
          VALID_SHAPES.includes(row.shape) ? row.shape : existing.shape,
          Number.isFinite(row.pos_x) ? row.pos_x : existing.pos_x,
          Number.isFinite(row.pos_y) ? row.pos_y : existing.pos_y,
          Number.isFinite(row.width) ? row.width : existing.width,
          Number.isFinite(row.height) ? row.height : existing.height,
          Number.isFinite(row.sort_order) ? row.sort_order : existing.sort_order,
          row.id
        );
      }
    });

    try {
      applyAll(tables);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    res.json(listTables.all());
  });

  router.put('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getTable.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'table not found' });
    }

    const { label, seats, shape, pos_x, pos_y, width, height } = req.body ?? {};
    db.prepare(
      'UPDATE tables SET label = ?, seats = ?, shape = ?, pos_x = ?, pos_y = ?, width = ?, height = ? WHERE id = ?'
    ).run(
      typeof label === 'string' && label.trim() !== '' ? label.trim() : existing.label,
      Number.isInteger(seats) && seats > 0 ? seats : existing.seats,
      VALID_SHAPES.includes(shape) ? shape : existing.shape,
      Number.isFinite(pos_x) ? pos_x : existing.pos_x,
      Number.isFinite(pos_y) ? pos_y : existing.pos_y,
      Number.isFinite(width) ? width : existing.width,
      Number.isFinite(height) ? height : existing.height,
      id
    );
    res.json(getTable.get(id));
  });

  router.delete('/:id', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getTable.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'table not found' });
    }
    db.prepare('UPDATE tables SET active = 0 WHERE id = ?').run(id);
    res.json({ ...existing, active: 0 });
  });

  return router;
}

module.exports = { createTablesRouter };
