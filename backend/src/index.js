require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { initDb } = require('./db/init');
const { createAuthRouter } = require('./routes/auth');
const { createUsersRouter } = require('./routes/users');
const { createTablesRouter } = require('./routes/tables');
const { createSettingsRouter } = require('./routes/settings');
const { createMenuRouter } = require('./routes/menu');
const { createOrdersRouter } = require('./routes/orders');

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || './data/openeats.db';

if (!process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set — refusing to start with no way to sign staff sign-in tokens.');
  process.exit(1);
}

const db = initDb(DB_PATH);

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', createAuthRouter(db));
app.use('/api/admin/users', createUsersRouter(db));
app.use('/api/tables', createTablesRouter(db));
app.use('/api/settings', createSettingsRouter(db));
app.use('/api/menu', createMenuRouter(db));
app.use('/api/orders', createOrdersRouter(db));

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.listen(PORT, () => {
  console.log(`OpenEats backend listening on port ${PORT}`);
});
