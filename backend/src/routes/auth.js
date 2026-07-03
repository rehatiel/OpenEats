const express = require('express');
const jwt = require('jsonwebtoken');
const { findUserByPin } = require('../lib/pin');

const JWT_SECRET = process.env.JWT_SECRET;

function createAuthRouter(db) {
  const router = express.Router();

  router.post('/login', (req, res) => {
    const { pin } = req.body ?? {};
    if (typeof pin !== 'string' || !/^\d{4,6}$/.test(pin)) {
      return res.status(400).json({ error: 'pin must be a 4-6 digit numeric string' });
    }

    const user = findUserByPin(db, pin);
    if (!user) {
      return res.status(401).json({ error: 'Invalid PIN' });
    }

    // Kitchen terminals are shared displays that need to stay signed in
    // indefinitely — there's no one at that screen to re-punch a PIN
    // mid-service. Every other role gets a normal 12h shift-length token.
    const expiresIn = user.role === 'kitchen' ? '3650d' : '12h';
    const token = jwt.sign({ id: user.id, name: user.name, role: user.role }, JWT_SECRET, { expiresIn });

    res.json({ token, user: { id: user.id, name: user.name, role: user.role } });
  });

  return router;
}

module.exports = { createAuthRouter };
