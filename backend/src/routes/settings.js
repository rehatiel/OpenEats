const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const VALIDATORS = {
  tax_rate: (v) => typeof v === 'string' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1,
  restaurant_name: (v) => typeof v === 'string' && v.trim() !== '',
  idle_timeout_minutes: (v) => typeof v === 'string' && Number.isInteger(Number(v)) && Number(v) > 0,
};

function createSettingsRouter(db) {
  const router = express.Router();

  const listSettings = db.prepare('SELECT key, value FROM settings');
  const upsertSetting = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );

  const toObject = () => Object.fromEntries(listSettings.all().map((r) => [r.key, r.value]));

  // Any authenticated role can read settings — checkout needs tax_rate, and
  // every screen's idle-timeout enforcement needs idle_timeout_minutes.
  router.get('/', requireAuth, (_req, res) => {
    res.json(toObject());
  });

  router.put('/', requireAuth, requireRole('admin'), (req, res) => {
    const updates = req.body ?? {};
    for (const [key, value] of Object.entries(updates)) {
      const validate = VALIDATORS[key];
      if (!validate) {
        return res.status(400).json({ error: `unknown setting: ${key}` });
      }
      if (!validate(String(value))) {
        return res.status(400).json({ error: `invalid value for ${key}` });
      }
    }

    const applyAll = db.transaction((entries) => {
      for (const [key, value] of entries) {
        upsertSetting.run(key, String(value));
      }
    });
    applyAll(Object.entries(updates));

    res.json(toObject());
  });

  return router;
}

module.exports = { createSettingsRouter };
