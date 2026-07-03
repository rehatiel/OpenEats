# Changelog

All notable changes to OpenEats are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Nothing has been tagged as a release yet, so everything so far lives under **Unreleased**.

## [Unreleased]

### Added
- Staff PIN sign-in (`/login`) with roles — `admin`, `manager`, `staff`, `kitchen` — each gated to the appropriate screens, plus an admin-configurable idle-timeout auto-logout.
- Admin panel (`/admin`): user management (add/edit/deactivate, PIN uniqueness enforced), a drag-and-drop table layout editor (position/size/shape/seats), menu management, and platform settings (tax rate, restaurant name, idle timeout).
- Real order pipeline: "Send to Kitchen" creates authenticated orders via `POST /api/orders`, tracked through independent `kitchen_status` (new → cooking → ready → completed) and `payment_status` (unpaid → paid) axes.
- Kitchen Display System (`/kitchen`) polling real orders every 4s — tickets appear, advance, and clear with zero manual refresh.
- Floor plan (`/tables`) polling every 5s, deriving live per-table status (open / ordered / cooking / ready / needs bill) from real unpaid orders instead of mock data.
- Checkout: settles every unpaid order for a table as one tab (`PATCH /api/orders/pay-table`), or a single to-go/delivery order by id.
- Menu item photos — admin upload (`POST /api/menu/:id/image`), served from the same persistent volume as the database, shown on Order Entry's item tiles.
- Admin-defined quick customizations per menu item (e.g. "No pickles") — one-tap chips in a "Customize" sheet alongside free-text notes, merged into the same order-line note that already flows through to the kitchen ticket.
- To-go/delivery orders capture a customer name (shown on the KDS ticket in place of a table) and surface on a new `/pickup` queue once the kitchen finishes them, since they have no table to fall back on.
- Configurable bar and floor landmarks: a `tables.orderable` flag distinguishes real orderable tables (e.g. "Bar") from positioned-but-non-orderable landmarks (e.g. "Service Window") — both fully drag/resize/reposition-able in the admin layout editor, previously hardcoded and immovable.
- Printable receipts: after completing checkout, a receipt-formatted view (narrow, monospace, itemized) can be sent to a printer via the browser's print dialog.

### Changed
- Table status went from a single collapsed "occupied" state to distinct ordered/cooking states, so the floor plan shows kitchen progress at a glance.
- Small tap targets (cart quantity buttons, keypad, note entry) were enlarged across all customer/staff-facing screens for touch use (admin panel excluded).

### Fixed
- `POST /api/orders` previously had no auth check — the only unauthenticated write endpoint in the app. It's now behind `requireAuth` like every other route.
- Order timestamps are stored as explicit ISO-8601 UTC (`...Z`) instead of SQLite's zone-less default, so elapsed-time displays don't get silently misread as local time.
