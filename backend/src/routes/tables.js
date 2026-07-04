const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALID_SHAPES = ['square', 'round'];

function createTablesRouter(db) {
  const router = express.Router();

  const listTables = db.prepare('SELECT * FROM tables WHERE active = 1 ORDER BY sort_order');
  const getTable = db.prepare('SELECT * FROM tables WHERE id = ?');
  const insertTable = db.prepare(`
    INSERT INTO tables (label, seats, shape, pos_x, pos_y, width, height, sort_order, active, orderable)
    VALUES (@label, @seats, @shape, @pos_x, @pos_y, @width, @height, @sort_order, 1, @orderable)
  `);
  const nextSortOrder = db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS n FROM tables');
  const updateTableRow = db.prepare(
    'UPDATE tables SET label = ?, seats = ?, shape = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, sort_order = ?, orderable = ? WHERE id = ?'
  );
  const insertSeat = db.prepare(`
    INSERT INTO tables (label, seats, shape, pos_x, pos_y, width, height, sort_order, active, orderable, parent_table_id)
    VALUES (@label, 1, 'square', @pos_x, @pos_y, 56, 56, @sort_order, 1, 1, @parent_table_id)
  `);
  const listSeatsFor = db.prepare('SELECT * FROM tables WHERE parent_table_id = ? AND active = 1 ORDER BY sort_order');
  const deactivateTable = db.prepare('UPDATE tables SET active = 0 WHERE id = ?');
  const setOrderable = db.prepare('UPDATE tables SET orderable = ? WHERE id = ?');
  const hasOpenOrderForLabel = db.prepare(
    "SELECT 1 FROM orders WHERE table_identifier = ? AND payment_status = 'unpaid' LIMIT 1"
  );

  // `orderable` is only ever meaningfully overridden by explicit true/false —
  // anything else (missing, non-boolean) falls back to the given default.
  function resolveOrderable(value, fallback) {
    return typeof value === 'boolean' ? (value ? 1 : 0) : fallback;
  }

  // Any authenticated role can read the layout — every POS screen needs it.
  router.get('/', requireAuth, (_req, res) => {
    res.json(listTables.all());
  });

  router.post('/', requireAuth, requireRole('admin'), (req, res) => {
    const { label, seats, shape, orderable } = req.body ?? {};
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
      orderable: resolveOrderable(orderable, 1),
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
          resolveOrderable(row.orderable, existing.orderable),
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

    const { label, seats, shape, pos_x, pos_y, width, height, orderable } = req.body ?? {};
    db.prepare(
      'UPDATE tables SET label = ?, seats = ?, shape = ?, pos_x = ?, pos_y = ?, width = ?, height = ?, orderable = ? WHERE id = ?'
    ).run(
      typeof label === 'string' && label.trim() !== '' ? label.trim() : existing.label,
      Number.isInteger(seats) && seats > 0 ? seats : existing.seats,
      VALID_SHAPES.includes(shape) ? shape : existing.shape,
      Number.isFinite(pos_x) ? pos_x : existing.pos_x,
      Number.isFinite(pos_y) ? pos_y : existing.pos_y,
      Number.isFinite(width) ? width : existing.width,
      Number.isFinite(height) ? height : existing.height,
      resolveOrderable(orderable, existing.orderable),
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

  // Grows/shrinks a table's generated seat rows to `count` — deliberately
  // generic (any table can grow seats), not bar-specific; "Bar" is just the
  // first table an admin applies this to. Each seat is an otherwise
  // ordinary, independently-orderable `tables` row, so no other endpoint
  // needs to know seats exist at all.
  router.post('/:id/seats', requireAuth, requireRole('admin'), (req, res) => {
    const id = Number(req.params.id);
    const parent = getTable.get(id);
    if (!parent) {
      return res.status(404).json({ error: 'table not found' });
    }
    if (parent.parent_table_id) {
      return res.status(400).json({ error: 'a seat cannot itself have seats' });
    }

    const { count } = req.body ?? {};
    if (!Number.isInteger(count) || count < 0) {
      return res.status(400).json({ error: 'count must be a non-negative integer' });
    }

    const existingSeats = listSeatsFor.all(id);

    if (count < existingSeats.length) {
      const excess = existingSeats.slice(count);
      const blocked = excess.find((seat) => hasOpenOrderForLabel.get(seat.label));
      if (blocked) {
        return res.status(400).json({ error: `cannot remove ${blocked.label} — it has an unpaid order` });
      }
      db.transaction(() => {
        for (const seat of excess) deactivateTable.run(seat.id);
      })();
    } else if (count > existingSeats.length) {
      db.transaction(() => {
        for (let i = existingSeats.length; i < count; i++) {
          insertSeat.run({
            label: `${parent.label} - Seat ${i + 1}`,
            pos_x: parent.pos_x + i * 60,
            pos_y: parent.pos_y + parent.height + 20,
            sort_order: nextSortOrder.get().n,
            parent_table_id: id,
          });
        }
      })();
    }

    const seats = listSeatsFor.all(id);
    // Once a table has any seats, guests order at the seat, not "the whole
    // bar" as a unit — but it stays active so it still renders as a floor
    // landmark grouping its seats. Shrinking back to zero restores whatever
    // it was before (a normal table, in practice — `orderable` is only
    // ever flipped off *by this endpoint*, never independently set to a
    // landmark on a table that previously had seats). A table that never
    // had seats and receives a no-op `count: 0` call is left untouched, so
    // a real landmark's `orderable` can't be clobbered back to orderable.
    if (seats.length > 0) {
      setOrderable.run(0, id);
    } else if (existingSeats.length > 0) {
      setOrderable.run(1, id);
    }

    res.json({ parent: getTable.get(id), seats });
  });

  return router;
}

module.exports = { createTablesRouter };
