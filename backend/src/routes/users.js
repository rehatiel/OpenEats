const express = require('express');
const bcrypt = require('bcryptjs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { pinCollidesWithActiveUser } = require('../lib/pin');

const VALID_ROLES = ['admin', 'manager', 'staff', 'kitchen'];
const PIN_RE = /^\d{4,6}$/;

function createUsersRouter(db) {
  const router = express.Router();
  router.use(requireAuth, requireRole('admin'));

  const listUsers = db.prepare(
    'SELECT id, name, role, active, created_at FROM users ORDER BY active DESC, name'
  );
  const insertUser = db.prepare(
    'INSERT INTO users (name, role, pin_hash, active) VALUES (?, ?, ?, 1)'
  );
  const getUser = db.prepare('SELECT id, name, role, active, created_at FROM users WHERE id = ?');
  const countOtherActiveAdmins = db.prepare(
    "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?"
  );

  router.get('/', (_req, res) => {
    res.json(listUsers.all());
  });

  router.post('/', (req, res) => {
    const { name, role, pin } = req.body ?? {};
    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!VALID_ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
    }
    if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
      return res.status(400).json({ error: 'pin must be a 4-6 digit numeric string' });
    }
    if (pinCollidesWithActiveUser(db, pin)) {
      return res.status(400).json({ error: 'pin is already in use by another active user' });
    }

    const { lastInsertRowid } = insertUser.run(name.trim(), role, bcrypt.hashSync(pin, 10));
    res.status(201).json(getUser.get(lastInsertRowid));
  });

  router.put('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = getUser.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'user not found' });
    }

    const { name, role, active, pin } = req.body ?? {};
    const next = {
      name: typeof name === 'string' && name.trim() !== '' ? name.trim() : existing.name,
      role: existing.role,
      active: existing.active,
    };

    if (role !== undefined) {
      if (!VALID_ROLES.includes(role)) {
        return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
      }
      next.role = role;
    }
    if (active !== undefined) {
      next.active = active ? 1 : 0;
    }

    const demotingOrDeactivatingLastAdmin =
      existing.role === 'admin' &&
      existing.active === 1 &&
      (next.role !== 'admin' || next.active === 0) &&
      countOtherActiveAdmins.get(id).n === 0;
    if (demotingOrDeactivatingLastAdmin) {
      return res.status(400).json({ error: 'cannot demote or deactivate the last active admin' });
    }

    let pinHash = null;
    if (pin !== undefined) {
      if (typeof pin !== 'string' || !PIN_RE.test(pin)) {
        return res.status(400).json({ error: 'pin must be a 4-6 digit numeric string' });
      }
      if (pinCollidesWithActiveUser(db, pin, id)) {
        return res.status(400).json({ error: 'pin is already in use by another active user' });
      }
      pinHash = bcrypt.hashSync(pin, 10);
    }

    if (pinHash) {
      db.prepare('UPDATE users SET name = ?, role = ?, active = ?, pin_hash = ? WHERE id = ?').run(
        next.name,
        next.role,
        next.active,
        pinHash,
        id
      );
    } else {
      db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?').run(
        next.name,
        next.role,
        next.active,
        id
      );
    }

    res.json(getUser.get(id));
  });

  // Soft delete only — never hard-delete staff accounts, to preserve history.
  router.delete('/:id', (req, res) => {
    const id = Number(req.params.id);
    const existing = getUser.get(id);
    if (!existing) {
      return res.status(404).json({ error: 'user not found' });
    }
    if (existing.role === 'admin' && existing.active === 1 && countOtherActiveAdmins.get(id).n === 0) {
      return res.status(400).json({ error: 'cannot deactivate the last active admin' });
    }
    db.prepare('UPDATE users SET active = 0 WHERE id = ?').run(id);
    res.json(getUser.get(id));
  });

  return router;
}

module.exports = { createUsersRouter };
