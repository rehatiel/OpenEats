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

  // Wipes transactional/historical *activity* — orders, their line items,
  // guest payments, and purchase orders/lines — so dashboard/report numbers
  // start clean. Distinct from /demo-data above: master data (menu,
  // ingredients, vendors, tables, users, settings) is untouched here, and
  // /demo-data's menu/table content is untouched by this. guest_payments has
  // no FK to orders (order_ids is a JSON array, not a foreign key), so it's
  // deleted explicitly rather than relying on any cascade.
  router.delete('/clear-transaction-history', requireAuth, requireRole('admin'), (req, res) => {
    const { confirm } = req.body ?? {};
    if (confirm !== true) {
      return res.status(400).json({ error: 'confirm must be true' });
    }

    db.transaction(() => {
      db.prepare('DELETE FROM guest_payments').run();
      db.prepare('DELETE FROM order_items').run();
      db.prepare('DELETE FROM orders').run();
      db.prepare('DELETE FROM purchase_order_items').run();
      db.prepare('DELETE FROM purchase_orders').run();
      db.prepare(
        "DELETE FROM sqlite_sequence WHERE name IN ('orders', 'order_items', 'guest_payments', 'purchase_orders', 'purchase_order_items')"
      ).run();
    })();

    res.json({
      cleared: true,
      warning:
        'Ingredient stock levels were not restored — there is no stock ledger yet to replay against. Re-run a physical count if needed.',
    });
  });

  return router;
}

module.exports = { createAdminRouter };
