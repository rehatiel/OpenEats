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
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      unit          TEXT NOT NULL,
      current_stock REAL NOT NULL DEFAULT 0,
      unit_cost     REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS menu_items (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      name          TEXT NOT NULL,
      retail_price  REAL NOT NULL,
      category      TEXT,
      active        INTEGER NOT NULL DEFAULT 1
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
    -- referencing a table's label, not stored here.
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
      active     INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  seedDefaults(db);

  return db;
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
      INSERT INTO tables (label, seats, shape, pos_x, pos_y, width, height, sort_order, active)
      VALUES (@label, @seats, @shape, @pos_x, @pos_y, @width, @height, @sort_order, 1)
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
      });
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
