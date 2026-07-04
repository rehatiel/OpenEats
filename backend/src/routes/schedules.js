const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

// Shift schedules (the "budget" the Labor Variance report compares actual
// punches against) and time-off requests (tracked so a schedule can be
// built around it — feeds no report).
function createSchedulesRouter(db) {
  const router = express.Router();

  const getUser = db.prepare('SELECT id FROM users WHERE id = ?');
  const insertSchedule = db.prepare('INSERT INTO shift_schedules (user_id, starts_at, ends_at, notes) VALUES (?, ?, ?, ?)');
  const getSchedule = db.prepare('SELECT * FROM shift_schedules WHERE id = ?');
  // Standard interval-overlap test — a shift starting before the window ends
  // and ending after the window starts overlaps it, including shifts that
  // only partially fall inside.
  const schedulesOverlapping = db.prepare(`
    SELECT ss.*, u.name AS user_name
    FROM shift_schedules ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.starts_at < ? AND ss.ends_at > ?
    ORDER BY ss.starts_at
  `);

  router.get('/', requireAuth, (req, res) => {
    const { start, end } = req.query;
    if (typeof start !== 'string' || typeof end !== 'string') {
      return res.status(400).json({ error: 'start and end are required' });
    }
    res.json(schedulesOverlapping.all(end, start));
  });

  router.post('/', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const { user_id: userId, starts_at: startsAt, ends_at: endsAt, notes } = req.body ?? {};
    if (!getUser.get(userId)) {
      return res.status(400).json({ error: 'user_id is required and must reference an existing user' });
    }
    if (typeof startsAt !== 'string' || typeof endsAt !== 'string' || new Date(endsAt) <= new Date(startsAt)) {
      return res.status(400).json({ error: 'starts_at and ends_at are required, and ends_at must be after starts_at' });
    }
    const { lastInsertRowid } = insertSchedule.run(userId, startsAt, endsAt, typeof notes === 'string' ? notes.trim() || null : null);
    res.status(201).json(getSchedule.get(lastInsertRowid));
  });

  router.patch('/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getSchedule.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'schedule not found' });
    }
    const { starts_at: startsAt, ends_at: endsAt, notes } = req.body ?? {};
    const nextStartsAt = typeof startsAt === 'string' ? startsAt : existing.starts_at;
    const nextEndsAt = typeof endsAt === 'string' ? endsAt : existing.ends_at;
    if (new Date(nextEndsAt) <= new Date(nextStartsAt)) {
      return res.status(400).json({ error: 'ends_at must be after starts_at' });
    }
    db.prepare('UPDATE shift_schedules SET starts_at = ?, ends_at = ?, notes = ? WHERE id = ?').run(
      nextStartsAt,
      nextEndsAt,
      typeof notes === 'string' ? notes.trim() || null : existing.notes,
      id
    );
    res.json(getSchedule.get(id));
  });

  // Schedules are a forward-looking plan, not settled financial history like
  // punches/adjustments — a hard delete (e.g. a shift that never happened)
  // is fine here.
  router.delete('/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    if (!getSchedule.get(id)) {
      return res.status(404).json({ error: 'schedule not found' });
    }
    db.prepare('DELETE FROM shift_schedules WHERE id = ?').run(id);
    res.status(204).end();
  });

  const insertTimeOff = db.prepare(
    'INSERT INTO time_off_requests (user_id, start_date, end_date, notes) VALUES (?, ?, ?, ?)'
  );
  const getTimeOff = db.prepare('SELECT * FROM time_off_requests WHERE id = ?');
  const listAllTimeOff = db.prepare(`
    SELECT tor.*, u.name AS user_name
    FROM time_off_requests tor
    JOIN users u ON u.id = tor.user_id
    ORDER BY tor.start_date DESC
  `);
  const listOwnTimeOff = db.prepare('SELECT * FROM time_off_requests WHERE user_id = ? ORDER BY start_date DESC');

  router.get('/time-off', requireAuth, (req, res) => {
    const isManager = ['admin', 'manager'].includes(req.user.role);
    res.json(isManager ? listAllTimeOff.all() : listOwnTimeOff.all(req.user.id));
  });

  router.post('/time-off', requireAuth, (req, res) => {
    const { start_date: startDate, end_date: endDate, notes } = req.body ?? {};
    if (typeof startDate !== 'string' || typeof endDate !== 'string' || endDate < startDate) {
      return res.status(400).json({ error: 'start_date and end_date are required, and end_date must not be before start_date' });
    }
    const { lastInsertRowid } = insertTimeOff.run(req.user.id, startDate, endDate, typeof notes === 'string' ? notes.trim() || null : null);
    res.status(201).json(getTimeOff.get(lastInsertRowid));
  });

  router.patch('/time-off/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getTimeOff.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'time off request not found' });
    }
    const { status } = req.body ?? {};
    if (!['pending', 'approved', 'denied'].includes(status)) {
      return res.status(400).json({ error: "status must be one of: pending, approved, denied" });
    }
    db.prepare('UPDATE time_off_requests SET status = ? WHERE id = ?').run(status, id);
    res.json(getTimeOff.get(id));
  });

  return router;
}

module.exports = { createSchedulesRouter };
