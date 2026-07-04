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

    -- Tax-relevant grouping for menu items (Food/Liquor/Wine/Beer), separate
    -- from the free-text 'category' on menu_items (which is display
    -- grouping, e.g. "Tacos"/"Burritos"). 'uncategorized' is the deliberate
    -- default for anything not yet classified — reports must surface it as
    -- its own bucket, never silently fold it into 'food'.
    CREATE TABLE IF NOT EXISTS menu_categories (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      name         TEXT NOT NULL UNIQUE,
      tax_category TEXT NOT NULL DEFAULT 'uncategorized' CHECK (tax_category IN ('food', 'liquor', 'wine', 'beer', 'uncategorized')),
      active       INTEGER NOT NULL DEFAULT 1
    );

    -- Per-line-item void/comp/discount, each requiring a manager's PIN to
    -- authorize (verified server-side against users.pin_hash independent of
    -- who's currently logged in — see POST /api/orders/:id/items/:itemId/adjustments).
    -- created_by is whoever initiated it (may be staff); authorized_by is
    -- always a manager/admin. A void additionally reverses that item's
    -- recipe-driven stock deduction.
    CREATE TABLE IF NOT EXISTS order_item_adjustments (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_item_id         INTEGER NOT NULL REFERENCES order_items(id),
      type                  TEXT NOT NULL CHECK (type IN ('void', 'comp', 'discount')),
      amount                REAL NOT NULL,
      reason                TEXT,
      authorized_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_by_user_id    INTEGER REFERENCES users(id),
      created_at            TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Whole-check comps/discounts/voids (e.g. "10% off the table"), same
    -- manager-authorization requirement as the per-item table above.
    CREATE TABLE IF NOT EXISTS order_adjustments (
      id                    INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id              INTEGER NOT NULL REFERENCES orders(id),
      type                  TEXT NOT NULL CHECK (type IN ('void', 'comp', 'discount')),
      amount                REAL NOT NULL,
      reason                TEXT,
      authorized_by_user_id INTEGER NOT NULL REFERENCES users(id),
      created_by_user_id    INTEGER REFERENCES users(id),
      created_at            TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- due_date drives AP Aging. status is only ever 'open' or 'paid' —
    -- "overdue" is deliberately NOT a stored status (it would drift from
    -- reality without a cron job); it's computed at query time from
    -- due_date instead.
    CREATE TABLE IF NOT EXISTS vendor_invoices (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      vendor_id         INTEGER NOT NULL REFERENCES vendors(id),
      purchase_order_id INTEGER REFERENCES purchase_orders(id),
      invoice_number    TEXT,
      invoice_date      TEXT NOT NULL,
      due_date          TEXT NOT NULL,
      amount            REAL NOT NULL,
      paid_date         TEXT,
      status            TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'paid')),
      notes             TEXT,
      created_at        TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Long-lived asset purchases (kitchen equipment, renovations, software
    -- platforms) — feeds the CapEx log report and, later, depreciation in
    -- the P&L/Balance Sheet.
    CREATE TABLE IF NOT EXISTS capex_items (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      description        TEXT NOT NULL,
      category           TEXT,
      purchase_date      TEXT NOT NULL,
      amount             REAL NOT NULL,
      vendor_id          INTEGER REFERENCES vendors(id),
      useful_life_months INTEGER,
      notes              TEXT,
      created_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- A physical count session; lines snapshot both what was counted and
    -- what the system expected at that moment (ingredients.current_stock
    -- before this count's corrections are applied), so the variance is
    -- reproducible later even after current_stock has moved on.
    CREATE TABLE IF NOT EXISTS physical_inventory_counts (
      id                 INTEGER PRIMARY KEY AUTOINCREMENT,
      counted_at         TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')),
      counted_by_user_id INTEGER REFERENCES users(id),
      notes              TEXT
    );

    CREATE TABLE IF NOT EXISTS physical_inventory_count_lines (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      count_id          INTEGER NOT NULL REFERENCES physical_inventory_counts(id),
      ingredient_id     INTEGER NOT NULL REFERENCES ingredients(id),
      counted_quantity  REAL NOT NULL,
      expected_quantity REAL NOT NULL,
      variance          REAL NOT NULL
    );

    -- Minimal double-entry ledger — exists ONLY to support Balance Sheet and
    -- Cash Flow, the two reports that structurally need real point-in-time
    -- account balances. Every other report reads its own purpose-built
    -- subledger directly (guest_payments, order_item_adjustments, etc.) —
    -- see backend/src/lib/ledger.js for the full design writeup (chart of
    -- accounts, daily-close posting logic, and the deliberate
    -- simplifications: no formal period-close, no category-level revenue
    -- split, depreciation derived at query time rather than posted).
    CREATE TABLE IF NOT EXISTS chart_of_accounts (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      code            TEXT NOT NULL UNIQUE,
      name            TEXT NOT NULL,
      type            TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
      normal_balance  TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit'))
    );

    -- One row per posted transaction. entry_date is a business day
    -- (YYYY-MM-DD), not a timestamp — a daily-close entry summarizes a whole
    -- day, so it has no more precise a time than that. source/source_id
    -- trace an entry back to what caused it (a daily close has no single
    -- triggering row, hence source_id NULL there).
    CREATE TABLE IF NOT EXISTS journal_entries (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_date  TEXT NOT NULL,
      source      TEXT NOT NULL CHECK (source IN ('daily_close', 'vendor_invoice', 'vendor_invoice_payment', 'capex')),
      source_id   INTEGER,
      memo        TEXT,
      created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- Balance enforced in application code (see ledger.js's postEntry, which
    -- refuses to commit an entry whose lines don't sum to zero) — SQLite has
    -- no cross-row aggregate CHECK to enforce debits=credits at the schema
    -- level.
    CREATE TABLE IF NOT EXISTS journal_lines (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      entry_id   INTEGER NOT NULL REFERENCES journal_entries(id),
      account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id),
      debit      REAL NOT NULL DEFAULT 0,
      credit     REAL NOT NULL DEFAULT 0
    );

    -- Wage rate HISTORY, not a single mutable column on users — a raise
    -- takes effect from its effective_date forward without rewriting the
    -- cost of hours already worked at the old rate (see lib/labor.js, which
    -- looks up "the rate in effect as of this punch," never "today's
    -- rate"). Deliberately no PII beyond what's needed to price hours — no
    -- withholding/tax/pay-stub fields; payroll stays out of scope.
    CREATE TABLE IF NOT EXISTS staff_wage_rates (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id        INTEGER NOT NULL REFERENCES users(id),
      hourly_rate    REAL NOT NULL,
      effective_date TEXT NOT NULL,
      created_at     TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    -- One row per punch. clock_out NULL means still on shift — only closed
    -- punches count toward labor cost (see lib/labor.js); an open punch is
    -- reported separately as "on shift now," never priced. A punch is
    -- attributed to its clock_in business day for reporting, even if the
    -- shift runs past local midnight.
    CREATE TABLE IF NOT EXISTS time_punches (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      clock_in   TEXT NOT NULL,
      clock_out  TEXT
    );

    -- The "budget" a Labor Variance report compares actual punches against.
    CREATE TABLE IF NOT EXISTS shift_schedules (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id    INTEGER NOT NULL REFERENCES users(id),
      starts_at  TEXT NOT NULL,
      ends_at    TEXT NOT NULL,
      notes      TEXT
    );

    -- Tracked so a schedule can be built around it; feeds no report.
    CREATE TABLE IF NOT EXISTS time_off_requests (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      start_date  TEXT NOT NULL,
      end_date    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
      notes       TEXT,
      created_at  TEXT NOT NULL DEFAULT (STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );
  `);

  // At most one daily-close entry per business day — a partial index (rather
  // than a plain UNIQUE column) since source_id is NULL for every daily_close
  // row and other sources can repeat freely. Backstops the application-level
  // "does today already have one" guard against a double-invocation race.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_entries_daily_close_date
      ON journal_entries(entry_date) WHERE source = 'daily_close'
  `);

  // At most one open punch per user — backstops the application-level
  // "already clocked in" guard the same way the daily-close index above
  // backstops that job, against a double clock-in race.
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_time_punches_one_open
      ON time_punches(user_id) WHERE clock_out IS NULL
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

  // Additive alongside the existing free-text `category` (display grouping)
  // — this is the tax-relevant grouping, backfilled below.
  ensureColumn(db, 'menu_items', 'category_id', 'INTEGER REFERENCES menu_categories(id)');

  // One-time-per-new-category backfill: every distinct free-text `category`
  // not yet mapped gets an auto-created menu_categories row (tax_category
  // defaults to 'uncategorized' — never silently assumed 'food'; an admin
  // must actively reclassify liquor/wine/beer/food). Naturally idempotent —
  // subsequent boots find no unmapped categories left.
  {
    const insertCategoryIfMissing = db.prepare(
      'INSERT INTO menu_categories (name, tax_category) VALUES (?, ?) ON CONFLICT(name) DO NOTHING'
    );
    const getCategoryByName = db.prepare('SELECT id FROM menu_categories WHERE name = ?');
    const setCategoryId = db.prepare('UPDATE menu_items SET category_id = ? WHERE category = ? AND category_id IS NULL');
    const unmapped = db
      .prepare('SELECT DISTINCT category FROM menu_items WHERE category IS NOT NULL AND category_id IS NULL')
      .all();
    for (const { category } of unmapped) {
      insertCategoryIfMissing.run(category, 'uncategorized');
      const { id } = getCategoryByName.get(category);
      setCategoryId.run(id, category);
    }
  }

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

// The minimal chart of accounts the ledger needs — see the schema comment
// above chart_of_accounts for why it's this short. INSERT OR IGNORE on the
// unique `code` makes this safe to call on every boot, so a future account
// addition just needs a new line here rather than a one-time migration.
function seedChartOfAccounts(db) {
  const accounts = [
    { code: '1000', name: 'Cash and Cash Equivalents', type: 'asset', normal_balance: 'debit' },
    { code: '1050', name: 'Accounts Receivable (Guest Checks)', type: 'asset', normal_balance: 'debit' },
    { code: '1200', name: 'Inventory', type: 'asset', normal_balance: 'debit' },
    { code: '1500', name: 'Fixed Assets', type: 'asset', normal_balance: 'debit' },
    { code: '2000', name: 'Accounts Payable', type: 'liability', normal_balance: 'credit' },
    { code: '2100', name: 'Sales Tax Payable', type: 'liability', normal_balance: 'credit' },
    { code: '2200', name: 'Tips Payable', type: 'liability', normal_balance: 'credit' },
    { code: '3000', name: 'Retained Earnings', type: 'equity', normal_balance: 'credit' },
    { code: '4000', name: 'Sales Revenue', type: 'revenue', normal_balance: 'credit' },
    { code: '5000', name: 'Cost of Goods Sold', type: 'expense', normal_balance: 'debit' },
    { code: '5900', name: 'Operating Expenses', type: 'expense', normal_balance: 'debit' },
  ];
  const insert = db.prepare(
    'INSERT INTO chart_of_accounts (code, name, type, normal_balance) VALUES (@code, @name, @type, @normal_balance) ON CONFLICT(code) DO NOTHING'
  );
  for (const account of accounts) insert.run(account);
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

  seedChartOfAccounts(db);

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
