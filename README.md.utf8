# OpenEats

> **⚠️ Early work in progress.** OpenEats is under active development and not
> production-ready. Expect missing features, rough edges, and breaking
> changes without notice. Feedback and contributions are welcome.

OpenEats is a self-hosted, restaurant point-of-sale (POS) system: order
counter, kitchen display, table floor plan, checkout/tender, and a sales
dashboard, backed by a small Express + SQLite API. It's built to run on a
single machine (e.g. a back-office PC or a low-cost mini PC) behind Docker
Compose, with no cloud dependency.

## Screenshots

### Counter (order entry)
Staff build an order by category and item, with dine-in / to-go / delivery
toggles and a live running cart.

![Order counter](docs/screenshots/order-counter.png)

### Floor plan
A live view of tables — seats, open/occupied/ready/needs-bill status, and the
current ticket for whichever table is selected.

![Floor plan](docs/screenshots/tables.png)

### Kitchen display
A ticket rail for the kitchen, grouped by order type, with per-ticket
"Start Cooking" / "Mark Ready" actions and a late-order indicator.

![Kitchen display](docs/screenshots/kitchen.png)

### Checkout
Tender by cash, card, or split, with quick-cash buttons and automatic change
calculation.

![Checkout](docs/screenshots/checkout.png)

### Dashboard
Gross sales, food cost, gross profit, and per-item margin, plus a low-stock
callout, computed from live order and recipe-cost data.

![Dashboard](docs/screenshots/dashboard.png)

### Admin — staff accounts
Manage staff logins and roles (admin / manager / staff), each authenticated
by PIN.

![Admin users](docs/screenshots/admin-users.png)

### Admin — settings
Restaurant name, sales tax rate, and idle sign-out timeout, editable at
runtime without a backend restart.

![Admin settings](docs/screenshots/admin-settings.png)

### PIN sign-in
Staff sign in with a numeric PIN instead of a username/password.

![PIN login](docs/screenshots/login.png)

## Features

- **Order counter** — category-tabbed menu, running cart, dine-in table
  selection, to-go/delivery order types.
- **Table / floor plan management** — configurable table layout (position,
  seats, shape) with live occupancy status.
- **Kitchen display system (KDS)** — ticket queue with status progression
  (new → cooking → ready) and order-type filtering.
- **Checkout** — cash/card/split tender, quick-cash amounts, automatic change
  due.
- **Dashboard & reporting** — gross sales, food cost, gross profit and
  margin per item, computed dynamically from recipe/ingredient cost data at
  order time.
- **Admin panel** — manage staff accounts and roles, tables, and platform
  settings (restaurant name, tax rate, idle timeout).
- **PIN-based staff auth** — JWT-backed sign-in via 4–6 digit PIN, with
  role-gated access (admin / manager / staff).

## Tech stack

- **Frontend** — SvelteKit + TypeScript + Tailwind CSS, served as a static
  build behind nginx.
- **Backend** — Node.js + Express + better-sqlite3 (single-file SQLite
  database), authenticated with JWT.
- **Deployment** — Docker Compose (`frontend` + `backend` services, with a
  named volume for the SQLite file).

## Installation

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and Docker Compose

### Setup

1. Clone the repository and copy the example environment file:

   ```bash
   git clone <this-repo-url>
   cd OpenEats
   cp .env.example .env
   ```

2. Edit `.env` and set a real `JWT_SECRET` (a long random string — there is
   no safe default, and the backend refuses to start without one). Optionally
   adjust `TAX_RATE` and `BOOTSTRAP_ADMIN_PIN` — both only seed the database
   on first boot and can be changed later from the admin panel.

3. Start the stack:

   ```bash
   docker compose up -d --build
   ```

4. Open the app:

   - Frontend: [http://localhost:8080](http://localhost:8080)
   - Backend API: [http://localhost:3000/api/health](http://localhost:3000/api/health)

5. Sign in with the bootstrap admin PIN (default `1234`, or whatever you set
   as `BOOTSTRAP_ADMIN_PIN`), then change it immediately from **Admin →
   Users**.

### Running without Docker (development)

```bash
# backend
cd backend
npm install
JWT_SECRET=dev-secret npm run dev   # http://localhost:3000

# frontend (separate terminal)
cd frontend
npm install
npm run dev                         # http://localhost:5173
```

> Note: `better-sqlite3` compiles a native module on install. On Windows
> this requires the Visual Studio "Desktop development with C++" build
> tools; Docker avoids this entirely and is the recommended path.

## Configuration

| Variable              | Description                                                        | Default |
| ---------------------- | ------------------------------------------------------------------- | ------- |
| `JWT_SECRET`           | Secret used to sign staff sign-in tokens. **Required, no default.** | —       |
| `TAX_RATE`             | First-boot sales tax rate seed (edit later via Admin → Settings).   | `0.0825`|
| `BOOTSTRAP_ADMIN_PIN`  | PIN for the auto-created default admin account on first boot.      | `1234`  |

## Status

This project is a work in progress. Known gaps include: live order status on
the floor plan and KDS is not yet wired to persisted order state end-to-end,
menu/ingredient/recipe management has no admin UI yet, and there's no
automated test suite. Contributions and issue reports are welcome.
