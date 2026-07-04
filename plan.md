# OpenEats Build Plan — Status & Remaining Phases

Source plan: `C:\Users\Ben\.claude\plans\streamed-jingling-zebra.md` (full original scoping). This file tracks what's actually been built and what's left, so remaining phases can be picked up without re-discovery.

## Status

- **Phase 1** (tips, bar/station routing, real dashboard) — done.
- **Phase 2** (full accounting & reporting suite) — done (chart of accounts, journal entries, vendor invoices, capex, physical inventory counts, reports registry + `ReportTable.svelte`).
- **Phase 3 — Time clock & schedules** — done:
  - `staff_wage_rates` (history by effective date), `time_punches`, `shift_schedules`, `time_off_requests` tables.
  - `backend/src/routes/timeClock.js` — clock-in/out/on-shift are **public** (no auth, PIN is the credential — supports a dedicated kiosk terminal with no logged-in session); `/punches` and `/wage-rates` remain admin/manager-gated.
  - `backend/src/routes/schedules.js` — CRUD for shifts + time-off requests.
  - `backend/src/routes/reports.js` — `labor-cost` and `labor-variance` reports, priced against the wage rate in effect on each punch's *local* business date.
  - Frontend: `/punch` kiosk page (reachable unauthenticated — special-cased in `+layout.svelte`'s route guard), `/admin/wage-rates`, `/admin/schedules` (list view **and** calendar view toggle).
- Three standalone bug fixes also shipped this session (checkout return-to-register path, bar-seat tile decluttering, table-context carry-through to the order screen).
- **Phase 4 — Order-ready popup + efficiency timer** — done:
  - `order_items.ready_at`/`acknowledged_at` columns; `ready_at` stamped (once, never overwritten) the first time an item's status reaches `'ready'` via either `PATCH /api/orders/:id` (legacy, advances all rollup-station items) or `PATCH /api/orders/:id/station-status`.
  - `PATCH /api/orders/:id/items/:itemId/acknowledge` — any authenticated staff member dismisses a ready alert for one item; idempotent no-op if already acknowledged.
  - Frontend: `frontend/src/lib/stores/orderAlerts.ts` polls `GET /api/orders?kitchen_status=ready` every 5s independently of `/kitchen`'s/`/tables`'s own polls; `OrderReadyToast.svelte` mounted once in the root layout, visible on every staff page (including kitchen/bar themselves), starts/stops with auth state so it never runs on the public `/punch` kiosk.
  - `GET /api/reports/order-efficiency` + `order-ready-efficiency` registry entry — avg/max minutes from ready to acknowledged, by station.
  - Verified live: item ready → shows in `?kitchen_status=ready` → acknowledge stamps once (idempotent on retry) → report reflects the elapsed wait; 404s on bad order/item ids; 401 with no auth.
- **Phase 5 — Kitchen printer auto-print** — done:
  - `frontend/src/lib/components/KitchenTicketPrint.svelte` — invisible-except-`@media print`, mirrors `Receipt.svelte`'s `#receipt-print` pattern via a new `#kitchen-ticket-print` id (`app.css` updated to reveal either).
  - `frontend/src/lib/printQueue.ts` — a small serial print queue (`window.print()` opens one native dialog at a time; advances on the `afterprint` event with a 4s timeout fallback). Purely frontend, no schema change — the "audit trail" column mentioned as optional in the original scoping was skipped since dedup is handled client-side the same way as the kitchen new-ticket chime (skip printing on first load, only print orders not already seen).
  - `/kitchen` and `/bar` both enqueue a print job for each newly-arrived ticket when `settings.kitchen_printer_enabled` is on; each page owns its own queue/printer.
  - Verified: clean build, both pages load, `kitchen_printer_enabled` reads correctly from settings.
  - **Caveat for the owner**: the KDS/bar device needs an OS-default printer configured on that machine — this is a hardware/deployment detail the app can't guarantee or verify itself.
- Everything since Phase 3 in this session (bug fixes, Phase 3–5, table-picker fix, ready-alert redesign + staff-scoping, checkout float-rounding fix, kitchen new-order chime) is **uncommitted locally**. Confirm with the user before committing.

## All phases from the original roadmap are now built.

## Verification checklist (for whichever phase is picked up next)

- Backend: `docker compose up -d --build backend frontend`, then `docker compose logs backend --tail=50` for a clean boot.
- Curl-test new endpoints with a bearer token from `POST /api/auth/login` (except deliberately-public endpoints like `/api/time-clock/*`).
- Frontend: walk the golden path in a browser, not just type-check — this project doesn't treat `tsc` passing as feature-complete.
