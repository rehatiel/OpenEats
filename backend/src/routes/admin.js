const express = require('express');
const { requireAuth, requireRole } = require('../middleware/auth');

// Small grab-bag for admin-only maintenance actions that don't belong to any
// one resource — mounted at /api/admin alongside the existing
// /api/admin/users router.
function createAdminRouter(db) {
  const router = express.Router();

  // Soft-deletes every current table and menu item (the same reversible
  // flag each already supports individually) so a business can wipe the
  // seeded taco-shop content — or anything they've since added, since the
  // two are indistinguishable — before taking real orders. Order/order_items
  // history is untouched.
  router.delete('/demo-data', requireAuth, requireRole('admin'), (_req, res) => {
    const clear = db.transaction(() => {
      db.prepare('UPDATE tables SET active = 0 WHERE active = 1').run();
      db.prepare('UPDATE menu_items SET active = 0 WHERE active = 1').run();
    });
    clear();
    res.json({ cleared: true });
  });

  return router;
}

module.exports = { createAdminRouter };
