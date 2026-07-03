require('dotenv').config();

const path = require('path');
const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/init');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createTablesRouter } = require('./routes/tables');
const { createSettingsRouter } = require('./routes/settings');
const { createMenuRouter } = require('./routes/menu');
const { createOrdersRouter } = require('./routes/orders');
const { createIngredientsRouter } = require('./routes/ingredients');
const { createVendorsRouter } = require('./routes/vendors');
const { createPurchaseOrdersRouter } = require('./routes/purchaseOrders');
const { createAdminRouter } = require('./routes/admin');
const { createGuestPaymentsRouter } = require('./routes/guestPayments');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/openeats.db';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set — refusing to start with no way to sign staff sign-in tokens.');
  process.exit(1);
}

const db = initDb(DB_PATH);
const UPLOADS_DIR = path.join(path.dirname(DB_PATH), 'uploads');

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));

app.use('/api/auth', createAuthRouter(db));
app.use('/api/admin/users', createUsersRouter(db));
app.use('/api/tables', createTablesRouter(db));
app.use('/api/settings', createSettingsRouter(db));
app.use('/api/menu', createMenuRouter(db, UPLOADS_DIR));
app.use('/api/orders', createOrdersRouter(db));
app.use('/api/ingredients', createIngredientsRouter(db));
app.use('/api/vendors', createVendorsRouter(db));
app.use('/api/purchase-orders', createPurchaseOrdersRouter(db));
app.use('/api/admin', createAdminRouter(db));
app.use('/api/guest-payments', createGuestPaymentsRouter(db));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`OpenEats backend listening on port ${PORT}`);
});
