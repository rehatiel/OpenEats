const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');
const { findUserByPin } = require('../lib/pin');

// Punches and wage rates — no payroll fields (withholding, tax, pay stubs)
// by design; this exists only to price hours worked for the Labor Cost and
// Labor Variance reports.
function createTimeClockRouter(db) {
  const router = express.Router();

  const getOpenPunch = db.prepare('SELECT * FROM time_punches WHERE user_id = ? AND clock_out IS NULL');
  const insertPunch = db.prepare('INSERT INTO time_punches (user_id, clock_in) VALUES (?, ?)');
  const closePunch = db.prepare('UPDATE time_punches SET clock_out = ? WHERE id = ?');
  const getPunch = db.prepare('SELECT * FROM time_punches WHERE id = ?');
  const listOnShift = db.prepare(`
    SELECT tp.id, tp.user_id, u.name, tp.clock_in
    FROM time_punches tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.clock_out IS NULL
    ORDER BY tp.clock_in
  `);

  // Identity for a punch comes from the PIN entered at the kiosk, not
  // whoever's logged into the device — the same independence orders.js's
  // manager-approval uses, since the person punching in/out often isn't
  // whoever's signed into the register right now.
  function resolvePunchUser(req, res) {
    const { pin } = req.body ?? {};
    if (typeof pin !== 'string' || pin.trim() === '') {
      res.status(400).json({ error: 'pin is required' });
      return null;
    }
    const user = findUserByPin(db, pin);
    if (!user) {
      res.status(401).json({ error: 'pin did not match an active user' });
      return null;
    }
    return user;
  }

  // Deliberately public (no requireAuth) — a time clock needs to work on a
  // dedicated kiosk terminal that nobody is logged into, the same way
  // /api/auth/login is public and PIN is the only credential. The PIN is
  // still the actual authorization check; this just drops the requirement
  // that some OTHER session already be signed in on the device first.
  router.get('/on-shift', (_req, res) => {
    res.json(listOnShift.all());
  });

  router.post('/clock-in', (req, res) => {
    const user = resolvePunchUser(req, res);
    if (!user) return;
    // Backstopped by idx_time_punches_one_open, but checked here first so
    // the error message names who's already clocked in.
    if (getOpenPunch.get(user.id)) {
      return res.status(400).json({ error: `${user.name} is already clocked in` });
    }
    const { lastInsertRowid } = insertPunch.run(user.id, new Date().toISOString());
    res.status(201).json({ ...getPunch.get(lastInsertRowid), user_name: user.name });
  });

  router.post('/clock-out', (req, res) => {
    const user = resolvePunchUser(req, res);
    if (!user) return;
    const open = getOpenPunch.get(user.id);
    if (!open) {
      return res.status(400).json({ error: `${user.name} is not currently clocked in` });
    }
    closePunch.run(new Date().toISOString(), open.id);
    res.json({ ...getPunch.get(open.id), user_name: user.name });
  });

  router.get('/punches', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const { user_id: userId, start, end } = req.query;
    let sql = `
      SELECT tp.*, u.name AS user_name
      FROM time_punches tp
      JOIN users u ON u.id = tp.user_id
      WHERE 1=1
    `;
    const params = [];
    if (userId) {
      sql += ' AND tp.user_id = ?';
      params.push(Number(userId));
    }
    if (typeof start === 'string') {
      sql += ' AND tp.clock_in >= ?';
      params.push(start);
    }
    if (typeof end === 'string') {
      sql += ' AND tp.clock_in < ?';
      params.push(end);
    }
    sql += ' ORDER BY tp.clock_in DESC';
    res.json(db.prepare(sql).all(...params));
  });

  // Corrects a missed/forgotten punch — punches otherwise have no edit
  // path, and "forgot to clock out" is routine enough in practice to need
  // one. Admin/manager only, mirroring the manager-authorization bar used
  // for other financially-relevant corrections in this app.
  router.patch('/punches/:id', requireAuth, requireRole('admin', 'manager'), (req, res) => {
    const id = Number(req.params.id);
    const existing = getPunch.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'punch not found' });
    }

    const { clock_in: clockIn, clock_out: clockOut } = req.body ?? {};
    const nextClockIn = typeof clockIn === 'string' && clockIn.trim() !== '' ? clockIn : existing.clock_in;
    const nextClockOut =
      clockOut === null ? null : typeof clockOut === 'string' && clockOut.trim() !== '' ? clockOut : existing.clock_out;
    if (nextClockOut && new Date(nextClockOut) <= new Date(nextClockIn)) {
      return res.status(400).json({ error: 'clock_out must be after clock_in' });
    }

    db.prepare('UPDATE time_punches SET clock_in = ?, clock_out = ? WHERE id = ?').run(nextClockIn, nextClockOut, id);
    res.json(getPunch.get(id));
  });

  const getUser = db.prepare('SELECT id FROM users WHERE id = ?');
  const insertWageRate = db.prepare('INSERT INTO staff_wage_rates (user_id, hourly_rate, effective_date) VALUES (?, ?, ?)');
  const listWageRates = db.prepare(`
    SELECT wr.*, u.name AS user_name
    FROM staff_wage_rates wr
    JOIN users u ON u.id = wr.user_id
    ORDER BY u.name, wr.effective_date DESC
  `);
  const getWageRate = db.prepare('SELECT * FROM staff_wage_rates WHERE id = ?');

  router.get('/wage-rates', requireAuth, requireRole('admin'), (_req, res) => {
    res.json(listWageRates.all());
  });

  // Append-only, like capex_items — a raise or correction is a new dated
  // row, never an edit to history. Rewriting a past effective_date would
  // silently reprice labor cost already reported on.
  router.post('/wage-rates', requireAuth, requireRole('admin'), (req, res) => {
    const { user_id: userId, hourly_rate: hourlyRate, effective_date: effectiveDate } = req.body ?? {};
    if (!getUser.get(userId)) {
      return res.status(400).json({ error: 'user_id is required and must reference an existing user' });
    }
    if (typeof hourlyRate !== 'number' || !Number.isFinite(hourlyRate) || hourlyRate <= 0) {
      return res.status(400).json({ error: 'hourly_rate must be a positive number' });
    }
    if (typeof effectiveDate !== 'string' || effectiveDate.trim() === '') {
      return res.status(400).json({ error: 'effective_date is required' });
    }

    const { lastInsertRowid } = insertWageRate.run(userId, hourlyRate, effectiveDate);
    res.status(201).json(getWageRate.get(lastInsertRowid));
  });

  return router;
}

module.exports = { createTimeClockRouter };
