const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');

/**
 * Opens (creating if necessary) the SQLite database at `dbPath`, applies the
 * OpenEats schema, and returns the open connection for the caller to reuse.
 */
function initDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  const db = new Database(dbPath);

  // WAL improves crash resilience and read/write concurrency for a local,
  // single-writer POS process.
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS ingredients (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      name              TEXT NOT NULL,
      unit              TEXT NOT NULL,
      current_stock     REAL NOT NULL DEFAULT 0,
      unit_cost         REAL NOT NULL DEFAULT 0,
      reorder_threshold REAL NOT NULL DEFAULT 0,
      reorder_quantity  REAL NOT NULL DEFAULT 0,
      active            INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS vendors (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL,
      contact_name TEXT,
      phone        TEXT,
      email        TEXT,
      notes        TEXT,
      active       INTEGER NOT NULL DEFAULT 1
    );

    -- status='ordered' as soon as it's placed with the vendor; 'received' once
    -- stock has actually arrived, at which point ingredient stock/cost update
    -- (see purchaseOrders.js). No 'draft' stage — mirrors how orders here are
    -- created complete rather than built up incrementally.
    CREATE TABLE IF NOT EXISTS purchase_orders (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id        INTEGER NOT NULL REFERENCES vendors(id),
      order_number     TEXT,
      status           TEXT NOT NULL DEFAULT 'ordered' CHECK (status IN ('ordered', 'received', 'cancelled')),
      tracking_number  TEXT,
      notes            TEXT,
      created_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      ordered_at       TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      received_at      TEXT
    );

    CREATE TABLE IF NOT EXISTS purchase_order_items (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      purchase_order_id INTEGER NOT NULL REFERENCES purchase_orders(id),
      ingredient_id     INTEGER NOT NULL REFERENCES ingredients(id),
      quantity          REAL NOT NULL,
      unit_price_paid   REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      retail_price  REAL NOT NULL,
      category      TEXT,
      active        INTEGER NOT NULL DEFAULT 1,
      image_url     TEXT
    );

    -- Admin-defined quick customizations for a menu item (e.g. "no pickles"),
    -- surfaced as one-tap chips at order time instead of free-text only.
    CREATE TABLE IF NOT EXISTS menu_item_options (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id),
      label         TEXT NOT NULL,
      sort_order    INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS recipe_items (
      menu_item_id      INTEGER NOT NULL REFERENCES menu_items(id),
      ingredient_id     INTEGER NOT NULL REFERENCES ingredients(id),
      quantity_required REAL NOT NULL,
      PRIMARY KEY (menu_item_id, ingredient_id)
    );

    -- kitchen_status tracks the KDS prep lifecycle (new -> cooking -> ready ->
    -- completed); payment_status tracks whether the table/order has settled.
    -- These are independent axes — a table can be fully cooked and served
    -- (kitchen_status='completed') while still unpaid, which is exactly the
    -- "needs bill" signal the floor plan derives from real order data.
    -- timestamp is stored as ISO-8601 UTC with a trailing Z (not SQLite's bare
    -- CURRENT_TIMESTAMP, which omits the zone marker) so JS new Date(...)
    -- parses it as UTC instead of silently misreading it as local time.
    CREATE TABLE IF NOT EXISTS orders (
      id                   INTEGER PRIMARY KEY AUTOINCREMENT,
      type                 TEXT NOT NULL CHECK (type IN ('dine_in', 'to_go', 'delivery')),
      table_identifier     TEXT,
      customer_name        TEXT,
      server_name          TEXT,
      kitchen_status       TEXT NOT NULL DEFAULT 'new' CHECK (kitchen_status IN ('new', 'cooking', 'ready', 'completed')),
      payment_status       TEXT NOT NULL DEFAULT 'unpaid' CHECK (payment_status IN ('unpaid', 'paid')),
      subtotal             REAL NOT NULL DEFAULT 0,
      tax                  REAL NOT NULL DEFAULT 0,
      total                REAL NOT NULL DEFAULT 0,
      calculated_food_cost REAL NOT NULL DEFAULT 0,
      timestamp            TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Not in the original 4-table list, but required: without line items there
    -- is no record of what was ordered, so food cost/subtotal couldn't be
    -- computed (or re-derived later) at all. note carries kitchen-facing
    -- special instructions per line (e.g. "no onion").
    CREATE TABLE IF NOT EXISTS order_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id      INTEGER NOT NULL REFERENCES orders(id),
      menu_item_id  INTEGER NOT NULL REFERENCES menu_items(id),
      quantity      INTEGER NOT NULL,
      note          TEXT
    );

    CREATE TABLE IF NOT EXISTS users (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL,
      role       TEXT NOT NULL CHECK (role IN ('admin', 'manager', 'staff', 'kitchen')),
      pin_hash   TEXT NOT NULL,
      active     INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Table-layout configuration only (position/size/seats). Live occupancy
    -- status for the floor plan is derived at read time from orders rows
    -- referencing a table's label, not stored here. orderable=0 marks a row
    -- as a floor landmark (e.g. a service window) rather than a real table —
    -- excluded from Order Entry's table picker and rendered as a plain label
    -- pill instead of a status tile, but still positioned/resized through the
    -- same admin layout editor as every other row.
    CREATE TABLE IF NOT EXISTS tables (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      label      TEXT NOT NULL,
      seats      INTEGER NOT NULL DEFAULT 2,
      shape      TEXT NOT NULL DEFAULT 'square' CHECK (shape IN ('square', 'round')),
      pos_x      INTEGER NOT NULL DEFAULT 0,
      pos_y      INTEGER NOT NULL DEFAULT 0,
      width      INTEGER NOT NULL DEFAULT 112,
      height     INTEGER NOT NULL DEFAULT 112,
      sort_order INTEGER NOT NULL DEFAULT 0,
      active     INTEGER NOT NULL DEFAULT 1,
      orderable  INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    -- One row per payment collected toward a table's tab — whether that's
    -- the whole table paid at once (guest_label = 'Table') or one guest's
    -- share of a split bill. order_ids (not just table_identifier) is what
    -- "already collected" is computed from, so a table label reused on a
    -- later visit doesn't pick up stale payments from a prior, already-paid
    -- visit. items_summary is a JSON snapshot for reprinting this payment's
    -- receipt later, independent of whatever the live order_items say now.
    CREATE TABLE IF NOT EXISTS guest_payments (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      table_identifier TEXT NOT NULL,
      order_ids        TEXT NOT NULL,
      guest_label      TEXT NOT NULL,
      subtotal         REAL NOT NULL,
      tax              REAL NOT NULL,
      total            REAL NOT NULL,
      tender_type      TEXT NOT NULL CHECK (tender_type IN ('cash', 'card', 'split')),
      tendered_amount  REAL NOT NULL,
      items_summary    TEXT NOT NULL,
      paid_at          TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // CREATE TABLE IF NOT EXISTS above only applies schema to a brand-new
  // database file — an already-existing volume from a prior deploy needs
  // these columns added explicitly.
  ensureColumn(db, 'menu_items', 'image_url', 'TEXT');
  ensureColumn(db, 'orders', 'customer_name', 'TEXT');
  ensureColumn(db, 'tables', 'orderable', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumn(db, 'ingredients', 'reorder_threshold', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'ingredients', 'reorder_quantity', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'ingredients', 'active', 'INTEGER NOT NULL DEFAULT 1');
  // Stamped when "Print Bill" is used pre-payment — feeds the Register queue
  // so staff can see which tables have already been given their check.
  ensureColumn(db, 'orders', 'bill_printed_at', 'TEXT');

  // A non-null parent_table_id marks a row as a generated seat (e.g. a bar
  // seat) whose tab is independent — see POST /api/tables/:id/seats.
  ensureColumn(db, 'tables', 'parent_table_id', 'INTEGER REFERENCES tables(id)');

  // Which prep station a menu item routes to when ordered. 'none' items
  // (e.g. a bottled drink) are tracked for reporting but shown on no
  // display. Validated in the route layer, not via CHECK, matching this
  // file's existing convention for migrated columns.
  ensureColumn(db, 'menu_items', 'station', "TEXT NOT NULL DEFAULT 'kitchen'");

  // order_items.station is snapshotted from menu_items.station at order
  // creation — reclassifying a menu item later must not rewrite the
  // routing of historical tickets. order_items.status is the per-item
  // analogue of orders.kitchen_status; orders.kitchen_status becomes a
  // rollup over these (see recomputeOrderKitchenStatus in orders.js) so
  // existing readers of the order-level field are unaffected.
  ensureColumn(db, 'order_items', 'station', "TEXT NOT NULL DEFAULT 'kitchen'");
  ensureColumn(db, 'order_items', 'status', "TEXT NOT NULL DEFAULT 'new'");

  // Tip/tender-split/CC-fee tracking, and a durable+display join to the
  // server who gets credit for the tip (order's server, not the checkout
  // operator).
  ensureColumn(db, 'guest_payments', 'tip_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'guest_payments', 'cash_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'guest_payments', 'card_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'guest_payments', 'cc_fee_amount', 'REAL NOT NULL DEFAULT 0');
  ensureColumn(db, 'guest_payments', 'server_user_id', 'INTEGER REFERENCES users(id)');
  ensureColumn(db, 'guest_payments', 'server_name', 'TEXT');

  // One-time backfill: pre-migration order_items default to status='new'
  // (the column default), which would make every historical completed
  // order reappear as a fresh ticket on the KDS after upgrade. Inherit the
  // parent order's kitchen_status instead wherever it's more advanced than
  // 'new'. Naturally idempotent — a second run finds nothing left matching
  // the WHERE clause — so no separate migration-ran flag is needed.
  db.exec(`
    UPDATE order_items
    SET status = (SELECT o.kitchen_status FROM orders o WHERE o.id = order_items.order_id)
    WHERE status = 'new' AND EXISTS (
      SELECT 1 FROM orders o WHERE o.id = order_items.order_id AND o.kitchen_status != 'new'
    )
  `);

  seedDefaults(db);

  return db;
}

function ensureColumn(db, table, column, ddl) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!columns.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

// Idempotent first-run seed, guarded by row-count checks so it's a no-op on
// every boot after the first.
function seedDefaults(db) {
  const { n: userCount } = db.prepare('SELECT COUNT(*) AS n FROM users').get();
  if (userCount === 0) {
    const bootstrapPin = process.env.BOOTSTRAP_ADMIN_PIN || '1234';
    db.prepare('INSERT INTO users (name, role, pin_hash, active) VALUES (?, ?, ?, 1)').run(
      'Admin',
      'admin',
      bcrypt.hashSync(bootstrapPin, 10)
    );
    console.log(
      `[seed] Created default admin user with PIN ${bootstrapPin} — change this immediately after first login.`
    );
  }

  const settingDefaults = {
    tax_rate: String(process.env.TAX_RATE ?? '0.0825'),
    restaurant_name: 'El Camión',
    idle_timeout_minutes: '15',
    // Lets a business without dine-in seating (e.g. a food truck) turn that
    // order type off entirely; at least one must stay enabled (enforced in
    // the settings route, not here — this is just the first-boot default).
    service_dine_in: '1',
    service_to_go: '1',
    service_delivery: '1',
    accept_tips: '0',
    bar_enabled: '0',
    kitchen_printer_enabled: '0',
    cc_fee_percent: '0',
    ticket_footer_paid: 'Thank you!',
    ticket_footer_unpaid: 'Please pay at the counter',
    restaurant_timezone: 'America/Chicago',
  };
  const insertSettingIfMissing = db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)');
  for (const [key, value] of Object.entries(settingDefaults)) {
    insertSettingIfMissing.run(key, value);
  }

  const { n: tableCount } = db.prepare('SELECT COUNT(*) AS n FROM tables').get();
  if (tableCount === 0) {
    const seedTables = [
      { label: '1', seats: 2, shape: 'square' },
      { label: '2', seats: 4, shape: 'square' },
      { label: '3', seats: 2, shape: 'square' },
      { label: '4', seats: 2, shape: 'square' },
      { label: '5', seats: 6, shape: 'round' },
      { label: '6', seats: 4, shape: 'square' },
      { label: '7', seats: 4, shape: 'square' },
      { label: '8', seats: 2, shape: 'square' },
      { label: '9', seats: 4, shape: 'square' },
      { label: '10', seats: 2, shape: 'square' },
      { label: '11', seats: 4, shape: 'square' },
    ];
    const insertTable = db.prepare(`
      INSERT INTO tables (label, seats, shape, pos_x, pos_y, width, height, sort_order, active, orderable)
      VALUES (@label, @seats, @shape, @pos_x, @pos_y, @width, @height, @sort_order, 1, @orderable)
    `);
    seedTables.forEach((t, i) => {
      const size = t.shape === 'round' ? 150 : 112;
      insertTable.run({
        ...t,
        width: size,
        height: size,
        sort_order: i,
        pos_x: 48 + (i % 5) * 180,
        pos_y: 48 + Math.floor(i / 5) * 180,
        orderable: 1,
      });
    });

    // Real, admin-configurable rows for what used to be hardcoded floor-plan
    // decoration — the bar takes orders like any table, the service window
    // is a positioned landmark only (orderable: 0).
    insertTable.run({
      label: 'Bar',
      seats: 4,
      shape: 'square',
      pos_x: 948,
      pos_y: 48,
      width: 200,
      height: 110,
      sort_order: seedTables.length,
      orderable: 1,
    });
    insertTable.run({
      label: 'Service Window',
      seats: 1,
      shape: 'square',
      pos_x: 420,
      pos_y: 0,
      width: 220,
      height: 40,
      sort_order: seedTables.length + 1,
      orderable: 0,
    });
  }

  const { n: menuItemCount } = db.prepare('SELECT COUNT(*) AS n FROM menu_items').get();
  if (menuItemCount === 0) {
    const seedMenuItems = [
      { name: 'Al Pastor', category: 'Tacos', retail_price: 3.75 },
      { name: 'Carnitas', category: 'Tacos', retail_price: 3.75 },
      { name: 'Barbacoa', category: 'Tacos', retail_price: 4.25 },
      { name: 'Pollo Asado', category: 'Tacos', retail_price: 3.5 },
      { name: 'Pescado', category: 'Tacos', retail_price: 4.5 },
      { name: 'Nopales', category: 'Tacos', retail_price: 3.25 },
      { name: 'Chorizo', category: 'Tacos', retail_price: 3.75 },
      { name: 'Veggie', category: 'Tacos', retail_price: 3.25 },
      { name: 'Al Pastor Burrito', category: 'Burritos', retail_price: 8.5 },
      { name: 'Carnitas Burrito', category: 'Burritos', retail_price: 8.5 },
      { name: 'Veggie Burrito', category: 'Burritos', retail_price: 7.75 },
      { name: 'Chips & Guac', category: 'Sides', retail_price: 5.5 },
      { name: 'Chips & Salsa', category: 'Sides', retail_price: 3.5 },
      { name: 'Elote', category: 'Sides', retail_price: 4.0 },
      { name: 'Horchata', category: 'Drinks', retail_price: 3.0 },
      { name: 'Jarritos', category: 'Drinks', retail_price: 2.5 },
      { name: 'Agua Fresca', category: 'Drinks', retail_price: 3.0 },
      { name: 'Salsa Verde', category: 'Salsas', retail_price: 0.75 },
      { name: 'Salsa Roja', category: 'Salsas', retail_price: 0.75 },
      { name: 'Pico de Gallo', category: 'Salsas', retail_price: 0.75 },
    ];
    const insertMenuItem = db.prepare(
      'INSERT INTO menu_items (name, category, retail_price, active) VALUES (@name, @category, @retail_price, 1)'
    );
    seedMenuItems.forEach((item) => insertMenuItem.run(item));
  }
}

module.exports = { initDb };
