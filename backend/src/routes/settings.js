const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

const SERVICE_TYPE_KEYS = ['service_dine_in', 'service_to_go', 'service_delivery'];

const boolString = (v) => typeof v === 'string' && (v === '0' || v === '1');
const percentString = (v) => typeof v === 'string' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1;
const nonEmptyString = (v) => typeof v === 'string' && v.trim() !== '';
const validTimezone = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return false;
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: v });
    return true;
  } catch {
    return false;
  }
};

const VALIDATORS = {
  tax_rate: (v) => typeof v === 'string' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 1,
  restaurant_name: (v) => typeof v === 'string' && v.trim() !== '',
  idle_timeout_minutes: (v) => typeof v === 'string' && Number.isInteger(Number(v)) && Number(v) > 0,
  service_dine_in: boolString,
  service_to_go: boolString,
  service_delivery: boolString,
  accept_tips: boolString,
  bar_enabled: boolString,
  kitchen_printer_enabled: boolString,
  kitchen_display_enabled: boolString,
  ready_alert_all_staff: boolString,
  cc_fee_percent: percentString,
  ticket_footer_paid: nonEmptyString,
  ticket_footer_unpaid: nonEmptyString,
  restaurant_timezone: validTimezone,
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

    // A business must always support at least one order type — merge the
    // incoming change with whatever's already stored before checking, since
    // an update might only touch one of the three keys.
    if (SERVICE_TYPE_KEYS.some((key) => key in updates)) {
      const current = toObject();
      const stillEnabled = SERVICE_TYPE_KEYS.some((key) =>
        key in updates ? String(updates[key]) === '1' : current[key] !== '0'
      );
      if (!stillEnabled) {
        return res.status(400).json({ error: 'at least one service type must remain enabled' });
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
