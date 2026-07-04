const express = require('express');
const { DateTime } = require('luxon');
const { requireAuth } = require('../middleware/auth');
const { createLedgerHelper } = require('../lib/ledger');

const VALID_RANGES = ['today', 'week', 'month', 'year'];
const TAX_CATEGORIES = ['food', 'liquor', 'wine', 'beer', 'uncategorized'];

// Matches the STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now') format orders/guest_payments
// timestamps are stored in — always includes milliseconds so a boundary
// comparison (e.g. an order at exactly local midnight) can't be thrown off by
// one side of the comparison omitting the .SSS luxon's default toISO() would
// otherwise drop when it's .000.
function toSqlTimestamp(dt) {
  return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
}

// Resolves the [start, end) window for the requested range plus the
// immediately-preceding equivalent window (for the sales delta), in the
// restaurant's local timezone. Business day = local midnight-to-midnight —
// a restaurant open past midnight will have late-night sales bucketed into
// the next calendar day; a configurable start-hour is a later refinement,
// not required for Phase 1.
function resolveRange(rangeKey, tz) {
  const now = DateTime.now().setZone(tz);
  if (rangeKey === 'today') {
    const start = now.startOf('day');
    return { start, end: start.plus({ days: 1 }), prevStart: start.minus({ days: 1 }), prevEnd: start };
  }
  if (rangeKey === 'month') {
    const start = now.startOf('month');
    return { start, end: start.plus({ months: 1 }), prevStart: start.minus({ months: 1 }), prevEnd: start };
  }
  if (rangeKey === 'year') {
    const start = now.startOf('year');
    return { start, end: start.plus({ years: 1 }), prevStart: start.minus({ years: 1 }), prevEnd: start };
  }
  // 'week' — trailing 7 local days including today (matches the dashboard's
  // existing always-7-bars chart, not a calendar week).
  const start = now.startOf('day').minus({ days: 6 });
  const end = now.startOf('day').plus({ days: 1 });
  return { start, end, prevStart: start.minus({ days: 7 }), prevEnd: start };
}

function pctDelta(current, previous) {
  if (previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

function createReportsRouter(db) {
  const router = express.Router();
  const { getBalanceSheet, getCashFlow } = createLedgerHelper(db);

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');

  const aggregateOrders = db.prepare(`
    SELECT COUNT(*) AS orders, COALESCE(SUM(total), 0) AS grossSales, COALESCE(SUM(calculated_food_cost), 0) AS foodCost
    FROM orders
    WHERE timestamp >= ? AND timestamp < ?
  `);

  const seriesOrders = db.prepare(`
    SELECT timestamp, total, calculated_food_cost AS foodCost
    FROM orders
    WHERE timestamp >= ? AND timestamp < ?
  `);

  const marginTableQuery = db.prepare(`
    SELECT mi.id, mi.name, mi.retail_price AS price,
           COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS sold,
           COALESCE((
             SELECT SUM(ri.quantity_required * i.unit_cost)
             FROM recipe_items ri
             JOIN ingredients i ON i.id = ri.ingredient_id
             WHERE ri.menu_item_id = mi.id
           ), 0) AS foodCost
    FROM menu_items mi
    LEFT JOIN order_items oi ON oi.menu_item_id = mi.id
    LEFT JOIN orders o ON o.id = oi.order_id AND o.timestamp >= ? AND o.timestamp < ?
    WHERE mi.active = 1
    GROUP BY mi.id
    ORDER BY sold DESC
  `);

  // A payment split across both cash and card in one row would double-count
  // its tip into both buckets below — not handled specially in Phase 1,
  // since split-bill charges are tendered per-guest and practically always
  // single-method.
  const tipsByServerQuery = db.prepare(`
    SELECT COALESCE(server_name, 'Unknown') AS server,
           COALESCE(SUM(CASE WHEN cash_amount > 0 THEN tip_amount ELSE 0 END), 0) AS cashTips,
           COALESCE(SUM(CASE WHEN card_amount > 0 THEN tip_amount ELSE 0 END), 0) AS cardTips,
           COALESCE(SUM(tip_amount), 0) AS totalTips
    FROM guest_payments
    WHERE paid_at >= ? AND paid_at < ? AND tip_amount > 0
    GROUP BY server
    ORDER BY totalTips DESC
  `);

  // Any authenticated role can read — mirrors every other operational
  // report/read endpoint (checkout needs tax_rate, kitchen needs orders).
  router.get('/dashboard', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';

    const { start, end, prevStart, prevEnd } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);
    const prevStartSql = toSqlTimestamp(prevStart);
    const prevEndSql = toSqlTimestamp(prevEnd);

    const current = aggregateOrders.get(startSql, endSql);
    const previous = aggregateOrders.get(prevStartSql, prevEndSql);

    const grossSales = current.grossSales;
    const foodCost = current.foodCost;
    const grossProfit = grossSales - foodCost;

    const kpis = {
      grossSales,
      grossSalesDeltaPct: pctDelta(grossSales, previous.grossSales),
      foodCost,
      foodCostPct: grossSales > 0 ? (foodCost / grossSales) * 100 : 0,
      grossProfit,
      grossProfitMarginPct: grossSales > 0 ? (grossProfit / grossSales) * 100 : 0,
      orders: current.orders,
      avgTicket: current.orders > 0 ? grossSales / current.orders : 0,
    };

    // Always the trailing 7 local days ending today, independent of the
    // selected range — matches the dashboard's existing always-visible
    // week-at-a-glance chart.
    const weekStart = DateTime.now().setZone(tz).startOf('day').minus({ days: 6 });
    const weekEnd = DateTime.now().setZone(tz).startOf('day').plus({ days: 1 });
    const weekRows = seriesOrders.all(toSqlTimestamp(weekStart), toSqlTimestamp(weekEnd));
    const byDay = new Map();
    for (let i = 0; i < 7; i++) {
      const day = weekStart.plus({ days: i });
      byDay.set(day.toISODate(), { date: day.toISODate(), label: day.toFormat('ccc').slice(0, 2), sales: 0, foodCost: 0 });
    }
    for (const row of weekRows) {
      const localDate = DateTime.fromISO(row.timestamp, { zone: 'utc' }).setZone(tz).toISODate();
      const bucket = byDay.get(localDate);
      if (bucket) {
        bucket.sales += row.total;
        bucket.foodCost += row.foodCost;
      }
    }
    const week = Array.from(byDay.values());

    const marginTable = marginTableQuery.all(startSql, endSql).map((row) => ({
      ...row,
      marginPct: row.price > 0 ? ((row.price - row.foodCost) / row.price) * 100 : 0,
    }));

    const tipsByServer = getSetting.get('accept_tips')?.value === '1' ? tipsByServerQuery.all(startSql, endSql) : [];

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      kpis,
      week,
      marginTable,
      tipsByServer,
    });
  });

  // ---- Phase 2b: reports derivable without a general ledger ----

  // Nets out voided line amounts per item before summing by category — a
  // void means that revenue never happened at all, unlike a comp/discount
  // (still a real sale, just at a reduced price to the guest), which stays
  // in these gross-by-category figures uncorrected — see the `note` on the
  // response, since precisely allocating a discount/comp back to a
  // specific tax category is a harder problem deferred past Phase 2b.
  const salesByCategoryQuery = db.prepare(`
    SELECT COALESCE(mc.tax_category, 'uncategorized') AS taxCategory,
           COALESCE(SUM(
             oi.quantity * mi.retail_price - COALESCE((
               SELECT SUM(oia.amount) FROM order_item_adjustments oia
               WHERE oia.order_item_id = oi.id AND oia.type = 'void'
             ), 0)
           ), 0) AS sales
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    JOIN menu_items mi ON mi.id = oi.menu_item_id
    LEFT JOIN menu_categories mc ON mc.id = mi.category_id
    WHERE o.timestamp >= ? AND o.timestamp < ?
    GROUP BY taxCategory
  `);

  const tenderReconciliationQuery = db.prepare(`
    SELECT COALESCE(SUM(cash_amount), 0) AS cash,
           COALESCE(SUM(card_amount), 0) AS card,
           COALESCE(SUM(tip_amount), 0) AS tips,
           COALESCE(SUM(cc_fee_amount), 0) AS ccFees,
           COUNT(*) AS paymentCount
    FROM guest_payments
    WHERE paid_at >= ? AND paid_at < ?
  `);

  const sumItemAdjustmentsQuery = db.prepare(`
    SELECT COALESCE(SUM(oia.amount), 0) AS total
    FROM order_item_adjustments oia
    JOIN order_items oi ON oi.id = oia.order_item_id
    JOIN orders o ON o.id = oi.order_id
    WHERE o.timestamp >= ? AND o.timestamp < ?
  `);
  const sumOrderAdjustmentsQuery = db.prepare(`
    SELECT COALESCE(SUM(oa.amount), 0) AS total
    FROM order_adjustments oa
    JOIN orders o ON o.id = oa.order_id
    WHERE o.timestamp >= ? AND o.timestamp < ?
  `);
  function totalAdjustments(startSql, endSql) {
    return sumItemAdjustmentsQuery.get(startSql, endSql).total + sumOrderAdjustmentsQuery.get(startSql, endSql).total;
  }

  // ORDER BY references column position 6 (created_at) rather than the
  // name — SQLite compound SELECTs (UNION ALL) don't reliably resolve a
  // named ORDER BY term against the combined result set.
  const adjustmentLogQuery = db.prepare(`
    SELECT 'item' AS scope, oia.id, oia.type, oia.amount, oia.reason, oia.created_at,
           oi.order_id AS order_id, oia.order_item_id AS order_item_id,
           u1.name AS authorized_by_name, u2.name AS created_by_name
    FROM order_item_adjustments oia
    JOIN order_items oi ON oi.id = oia.order_item_id
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN users u1 ON u1.id = oia.authorized_by_user_id
    LEFT JOIN users u2 ON u2.id = oia.created_by_user_id
    WHERE o.timestamp >= ? AND o.timestamp < ?

    UNION ALL

    SELECT 'order' AS scope, oa.id, oa.type, oa.amount, oa.reason, oa.created_at,
           oa.order_id AS order_id, NULL AS order_item_id,
           u1.name AS authorized_by_name, u2.name AS created_by_name
    FROM order_adjustments oa
    JOIN orders o ON o.id = oa.order_id
    LEFT JOIN users u1 ON u1.id = oa.authorized_by_user_id
    LEFT JOIN users u2 ON u2.id = oa.created_by_user_id
    WHERE o.timestamp >= ? AND o.timestamp < ?

    ORDER BY 6
  `);

  const pMixQuery = db.prepare(`
    SELECT mi.id, mi.name, mi.retail_price AS price,
           COALESCE(SUM(CASE WHEN o.id IS NOT NULL THEN oi.quantity ELSE 0 END), 0) AS sold,
           COALESCE((
             SELECT SUM(ri.quantity_required * i.unit_cost)
             FROM recipe_items ri
             JOIN ingredients i ON i.id = ri.ingredient_id
             WHERE ri.menu_item_id = mi.id
           ), 0) AS foodCost
    FROM menu_items mi
    LEFT JOIN order_items oi ON oi.menu_item_id = mi.id
    LEFT JOIN orders o ON o.id = oi.order_id AND o.timestamp >= ? AND o.timestamp < ?
    WHERE mi.active = 1
    GROUP BY mi.id
  `);

  const inventoryVarianceQuery = db.prepare(`
    SELECT i.id AS ingredient_id, i.name, i.unit, i.unit_cost,
           COALESCE(SUM(picl.variance), 0) AS totalVariance,
           COALESCE(SUM(picl.variance * i.unit_cost), 0) AS varianceValue
    FROM physical_inventory_count_lines picl
    JOIN physical_inventory_counts pic ON pic.id = picl.count_id
    JOIN ingredients i ON i.id = picl.ingredient_id
    WHERE pic.counted_at >= ? AND pic.counted_at < ?
    GROUP BY i.id
    ORDER BY varianceValue ASC
  `);

  const closedPunchesForPeriod = db.prepare(`
    SELECT tp.id, tp.user_id, u.name, tp.clock_in, tp.clock_out
    FROM time_punches tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.clock_out IS NOT NULL AND tp.clock_in >= ? AND tp.clock_in < ?
  `);
  const wageRatesForUser = db.prepare(
    'SELECT hourly_rate, effective_date FROM staff_wage_rates WHERE user_id = ? ORDER BY effective_date DESC, id DESC'
  );
  const onShiftNowQuery = db.prepare(`
    SELECT tp.id, tp.user_id, u.name, tp.clock_in
    FROM time_punches tp
    JOIN users u ON u.id = tp.user_id
    WHERE tp.clock_out IS NULL
    ORDER BY tp.clock_in
  `);
  // The rate in effect AS OF the punch's (local business-day) date — never
  // "today's" rate, so a later raise doesn't retroactively reprice hours
  // already worked and already reported on.
  function rateForPunch(userId, localDateIso) {
    const match = wageRatesForUser.all(userId).find((r) => r.effective_date <= localDateIso);
    return match ? match.hourly_rate : null;
  }

  // A shift is attributed to whichever period its starts_at falls into —
  // same "don't split at the boundary" simplification as punches, rather
  // than clipping an overnight shift across two periods.
  const schedulesStartingInPeriod = db.prepare(`
    SELECT ss.user_id, u.name, ss.starts_at, ss.ends_at
    FROM shift_schedules ss
    JOIN users u ON u.id = ss.user_id
    WHERE ss.starts_at >= ? AND ss.starts_at < ?
  `);

  // Only items that actually got dismissed in the period — a ready item
  // nobody's acknowledged yet has no elapsed wait to report until it is.
  const readyAckItemsForPeriod = db.prepare(`
    SELECT oi.station, oi.ready_at, oi.acknowledged_at
    FROM order_items oi
    WHERE oi.ready_at IS NOT NULL AND oi.acknowledged_at IS NOT NULL
      AND oi.ready_at >= ? AND oi.ready_at < ?
  `);

  const openInvoicesQuery = db.prepare(`
    SELECT vi.*, v.name AS vendor_name
    FROM vendor_invoices vi
    JOIN vendors v ON v.id = vi.vendor_id
    WHERE vi.status = 'open'
    ORDER BY vi.due_date
  `);

  // Daily Sales Summary — gross/net revenue, tax, and sales split by
  // Food/Liquor/Wine/Beer/Uncategorized for a single business day.
  router.get('/daily-sales-summary', requireAuth, (req, res) => {
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const date = typeof req.query.date === 'string' && req.query.date.trim() !== '' ? req.query.date : null;
    const start = date ? DateTime.fromISO(date, { zone: tz }).startOf('day') : DateTime.now().setZone(tz).startOf('day');
    if (!start.isValid) {
      return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date' });
    }
    const end = start.plus({ days: 1 });
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);

    const agg = aggregateOrders.get(startSql, endSql);
    const taxCollected = db
      .prepare('SELECT COALESCE(SUM(tax), 0) AS tax FROM orders WHERE timestamp >= ? AND timestamp < ?')
      .get(startSql, endSql).tax;
    const adjustments = totalAdjustments(startSql, endSql);
    const salesByCategory = TAX_CATEGORIES.map((taxCategory) => ({ taxCategory, sales: 0 }));
    for (const row of salesByCategoryQuery.all(startSql, endSql)) {
      const bucket = salesByCategory.find((b) => b.taxCategory === row.taxCategory);
      if (bucket) bucket.sales = row.sales;
    }

    res.json({
      date: start.toISODate(),
      grossRevenue: agg.grossSales,
      taxCollected,
      netRevenue: agg.grossSales - taxCollected - adjustments,
      adjustments,
      orders: agg.orders,
      salesByCategory,
      note: 'salesByCategory nets out voided items but not comps/discounts — those remain at full price per category and are only reflected in the aggregate `adjustments` total.',
    });
  });

  // Cash/card totals actually collected vs. what the bank deposit should
  // show. Only cash/card exist as tender methods today (no processor
  // integration for network-level visa/amex/gift-card detail) — see Phase 1
  // notes. Pre-migration paid orders that predate guest_payments tracking
  // (or any future path that marks an order paid without a guest_payments
  // row) are invisible to this report.
  router.get('/tender-reconciliation', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'today';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const row = tenderReconciliationQuery.get(toSqlTimestamp(start), toSqlTimestamp(end));
    res.json({ range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() }, ...row });
  });

  // Product Mix — quantity and sales value for every active menu item in
  // the period.
  router.get('/product-mix', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const rows = pMixQuery.all(toSqlTimestamp(start), toSqlTimestamp(end));
    const totalSales = rows.reduce((sum, r) => sum + r.sold * r.price, 0);
    const items = rows
      .map((r) => ({
        id: r.id,
        name: r.name,
        price: r.price,
        sold: r.sold,
        salesValue: r.sold * r.price,
        pctOfSales: totalSales > 0 ? ((r.sold * r.price) / totalSales) * 100 : 0,
        marginPct: r.price > 0 ? ((r.price - r.foodCost) / r.price) * 100 : 0,
      }))
      .sort((a, b) => b.salesValue - a.salesValue);
    res.json({ range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() }, items });
  });

  // Voids/Comps/Discounts log — every manager-authorized adjustment in the
  // period, with who initiated and who authorized it.
  router.get('/voids-comps-discounts', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);
    const entries = adjustmentLogQuery.all(startSql, endSql, startSql, endSql);
    const totalsByType = { void: 0, comp: 0, discount: 0 };
    for (const e of entries) totalsByType[e.type] += e.amount;
    res.json({ range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() }, entries, totalsByType });
  });

  // Weekly Flash Report — a fast, approximate P&L snapshot (not a full
  // statement) to track trend, not for tax/accounting purposes.
  router.get('/weekly-flash-pnl', requireAuth, (req, res) => {
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange('week', tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);
    const agg = aggregateOrders.get(startSql, endSql);
    const adjustments = totalAdjustments(startSql, endSql);
    const netSales = agg.grossSales - adjustments;
    const grossProfit = netSales - agg.foodCost;
    res.json({
      range: { key: 'week', start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      grossSales: agg.grossSales,
      adjustments,
      netSales,
      foodCost: agg.foodCost,
      grossProfit,
      grossProfitMarginPct: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
      orders: agg.orders,
    });
  });

  // COGS & Inventory Variance — dollar variance found by physical counts
  // recorded in the period (counted_quantity vs. what the system expected
  // at that moment). Priced at each ingredient's CURRENT unit_cost, not the
  // cost at count time — consistent with how food cost is computed
  // elsewhere in this app, but means a since-changed unit_cost will
  // slightly skew historical variance value.
  router.get('/cogs-variance', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'month';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const rows = inventoryVarianceQuery.all(toSqlTimestamp(start), toSqlTimestamp(end));
    const totalVarianceValue = rows.reduce((sum, r) => sum + r.varianceValue, 0);
    res.json({ range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() }, ingredients: rows, totalVarianceValue });
  });

  // AP Aging — a current snapshot (not range-scoped) of every open vendor
  // invoice, bucketed by days overdue.
  router.get('/ap-aging', requireAuth, (req, res) => {
    const today = DateTime.now();
    const buckets = { current: [], '1-30': [], '31-60': [], '61-90': [], '90+': [] };
    for (const inv of openInvoicesQuery.all()) {
      const daysOverdue = Math.floor(today.diff(DateTime.fromISO(inv.due_date), 'days').days);
      const bucketKey = daysOverdue <= 0 ? 'current' : daysOverdue <= 30 ? '1-30' : daysOverdue <= 60 ? '31-60' : daysOverdue <= 90 ? '61-90' : '90+';
      buckets[bucketKey].push({ ...inv, days_overdue: Math.max(0, daysOverdue) });
    }
    const totalsByBucket = Object.fromEntries(
      Object.entries(buckets).map(([key, invs]) => [key, invs.reduce((sum, i) => sum + i.amount, 0)])
    );
    res.json({ asOf: today.toISODate(), buckets, totalsByBucket });
  });

  // Sales & gross-profit summary at monthly/annual cadence. Deliberately
  // NOT called a full P&L — operating expenses and net income require
  // categorized ledger accounts (Phase 2c) to separate true opex from
  // ingredient COGS already reflected in foodCost; asserting a number for
  // those here would be a fabricated, not derived, figure.
  router.get('/sales-summary', requireAuth, (req, res) => {
    const rangeKey = ['month', 'year'].includes(req.query.range) ? req.query.range : 'month';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);
    const agg = aggregateOrders.get(startSql, endSql);
    const adjustments = totalAdjustments(startSql, endSql);
    const netSales = agg.grossSales - adjustments;
    const grossProfit = netSales - agg.foodCost;
    const tender = tenderReconciliationQuery.get(startSql, endSql);
    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      grossSales: agg.grossSales,
      adjustments,
      netSales,
      foodCost: agg.foodCost,
      grossProfit,
      grossProfitMarginPct: netSales > 0 ? (grossProfit / netSales) * 100 : 0,
      tips: tender.tips,
      ccFees: tender.ccFees,
      orders: agg.orders,
      avgTicket: agg.orders > 0 ? agg.grossSales / agg.orders : 0,
      note: 'Operating expenses and net income require the general ledger (Phase 2c) and are not included here.',
    });
  });

  // Menu Engineering Matrix — classifies items by popularity (sold count)
  // and profitability (margin %) relative to the MEDIAN of items that sold
  // at least one unit in the period (median, not mean, so a couple of
  // outlier sellers can't drag every other item into the same bucket).
  router.get('/menu-engineering', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'month';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const rows = pMixQuery
      .all(toSqlTimestamp(start), toSqlTimestamp(end))
      .filter((r) => r.sold > 0)
      .map((r) => ({ id: r.id, name: r.name, sold: r.sold, marginPct: r.price > 0 ? ((r.price - r.foodCost) / r.price) * 100 : 0 }));

    function median(nums) {
      if (nums.length === 0) return 0;
      const sorted = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    }
    const popularityThreshold = median(rows.map((r) => r.sold));
    const marginThreshold = median(rows.map((r) => r.marginPct));

    const items = rows.map((r) => {
      const popular = r.sold >= popularityThreshold;
      const profitable = r.marginPct >= marginThreshold;
      const classification = popular && profitable ? 'star' : popular ? 'plowhorse' : profitable ? 'puzzle' : 'dog';
      return { ...r, classification };
    });

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      popularityThreshold,
      marginThreshold,
      items,
    });
  });

  // Year-over-year — this period vs. the same calendar period one year
  // earlier (not the "immediately preceding period" the dashboard delta
  // uses).
  router.get('/yoy', requireAuth, (req, res) => {
    const rangeKey = ['month', 'year'].includes(req.query.range) ? req.query.range : 'year';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const priorStart = start.minus({ years: 1 });
    const priorEnd = end.minus({ years: 1 });

    const current = aggregateOrders.get(toSqlTimestamp(start), toSqlTimestamp(end));
    const prior = aggregateOrders.get(toSqlTimestamp(priorStart), toSqlTimestamp(priorEnd));

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      priorRange: { start: priorStart.toUTC().toISO(), end: priorEnd.toUTC().toISO() },
      current: { grossSales: current.grossSales, orders: current.orders, avgTicket: current.orders > 0 ? current.grossSales / current.orders : 0 },
      prior: { grossSales: prior.grossSales, orders: prior.orders, avgTicket: prior.orders > 0 ? prior.grossSales / prior.orders : 0 },
      grossSalesDeltaPct: pctDelta(current.grossSales, prior.grossSales),
    });
  });

  // Labor Cost & Punch Report — hours and cost per employee for the period,
  // priced at the wage rate in effect on each punch's date (not today's
  // rate). A punch is attributed to its clock_in business day even if the
  // shift runs past local midnight — splitting an overnight shift across
  // two days is a refinement this report doesn't need. Only closed punches
  // count toward cost; anyone still clocked in is surfaced separately under
  // onShiftNow, priced at $0 since their hours aren't final yet.
  router.get('/labor-cost', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);

    const byUser = new Map();
    let missingRateHours = 0;
    for (const p of closedPunchesForPeriod.all(startSql, endSql)) {
      const hours = (new Date(p.clock_out).getTime() - new Date(p.clock_in).getTime()) / 3600000;
      const localDate = DateTime.fromISO(p.clock_in, { zone: 'utc' }).setZone(tz).toISODate();
      const rate = rateForPunch(p.user_id, localDate);

      const entry = byUser.get(p.user_id) ?? { userId: p.user_id, name: p.name, hours: 0, cost: 0, missingRateHours: 0 };
      entry.hours += hours;
      if (rate != null) {
        entry.cost += hours * rate;
      } else {
        entry.missingRateHours += hours;
        missingRateHours += hours;
      }
      byUser.set(p.user_id, entry);
    }

    const byEmployee = Array.from(byUser.values()).sort((a, b) => b.cost - a.cost);
    const totalHours = byEmployee.reduce((sum, e) => sum + e.hours, 0);
    const totalCost = byEmployee.reduce((sum, e) => sum + e.cost, 0);

    const agg = aggregateOrders.get(startSql, endSql);
    const netSales = agg.grossSales - totalAdjustments(startSql, endSql);

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      byEmployee,
      totalHours,
      totalCost,
      netSales,
      laborCostPct: netSales > 0 ? (totalCost / netSales) * 100 : 0,
      onShiftNow: onShiftNowQuery.all(),
      note:
        missingRateHours > 0.005
          ? `${missingRateHours.toFixed(2)} hour(s) have no wage rate on file as of the punch date and are excluded from cost.`
          : null,
    });
  });

  // Labor Variance Report — scheduled vs. actual hours/cost per employee,
  // depends on shift_schedules existing (Phase 3b). Both sides are priced
  // at the wage rate in effect on the shift/punch's own date, so a variance
  // reflects hours worked vs. planned, not a rate change muddying the
  // comparison.
  router.get('/labor-variance', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);

    const byUser = new Map();
    function bucket(userId, name) {
      if (!byUser.has(userId)) {
        byUser.set(userId, { userId, name, scheduledHours: 0, scheduledCost: 0, actualHours: 0, actualCost: 0 });
      }
      return byUser.get(userId);
    }

    // Same "no wage rate on file" gap labor-cost surfaces — a missing rate
    // is priced as $0 here too (so the report still renders), but flagged
    // via `note` rather than silently understating cost/variance.
    let missingRateHours = 0;

    for (const s of schedulesStartingInPeriod.all(startSql, endSql)) {
      const hours = (new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime()) / 3600000;
      const localDate = DateTime.fromISO(s.starts_at, { zone: 'utc' }).setZone(tz).toISODate();
      const rate = rateForPunch(s.user_id, localDate);
      const entry = bucket(s.user_id, s.name);
      entry.scheduledHours += hours;
      if (rate != null) entry.scheduledCost += hours * rate;
      else missingRateHours += hours;
    }

    for (const p of closedPunchesForPeriod.all(startSql, endSql)) {
      const hours = (new Date(p.clock_out).getTime() - new Date(p.clock_in).getTime()) / 3600000;
      const localDate = DateTime.fromISO(p.clock_in, { zone: 'utc' }).setZone(tz).toISODate();
      const rate = rateForPunch(p.user_id, localDate);
      const entry = bucket(p.user_id, p.name);
      entry.actualHours += hours;
      if (rate != null) entry.actualCost += hours * rate;
      else missingRateHours += hours;
    }

    const byEmployee = Array.from(byUser.values())
      .map((e) => ({ ...e, hoursVariance: e.actualHours - e.scheduledHours, costVariance: e.actualCost - e.scheduledCost }))
      .sort((a, b) => Math.abs(b.costVariance) - Math.abs(a.costVariance));

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      byEmployee,
      note:
        missingRateHours > 0.005
          ? `${missingRateHours.toFixed(2)} hour(s) have no wage rate on file as of their date and are priced at $0.`
          : null,
      totalScheduledHours: byEmployee.reduce((sum, e) => sum + e.scheduledHours, 0),
      totalActualHours: byEmployee.reduce((sum, e) => sum + e.actualHours, 0),
      totalScheduledCost: byEmployee.reduce((sum, e) => sum + e.scheduledCost, 0),
      totalActualCost: byEmployee.reduce((sum, e) => sum + e.actualCost, 0),
    });
  });

  // Order-Ready Efficiency — how long a ticket sits ready before a server
  // dismisses the alert (acknowledged_at - ready_at), by station. Measures
  // service pickup speed, not kitchen/bar prep speed.
  router.get('/order-efficiency', requireAuth, (req, res) => {
    const rangeKey = VALID_RANGES.includes(req.query.range) ? req.query.range : 'week';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);

    const rows = readyAckItemsForPeriod
      .all(startSql, endSql)
      .map((r) => ({ station: r.station, minutes: (new Date(r.acknowledged_at).getTime() - new Date(r.ready_at).getTime()) / 60000 }));

    const byStation = new Map();
    for (const r of rows) {
      const entry = byStation.get(r.station) ?? { station: r.station, count: 0, totalMinutes: 0, maxMinutes: 0 };
      entry.count += 1;
      entry.totalMinutes += r.minutes;
      entry.maxMinutes = Math.max(entry.maxMinutes, r.minutes);
      byStation.set(r.station, entry);
    }

    const byStationOut = Array.from(byStation.values())
      .map((e) => ({
        station: e.station,
        count: e.count,
        avgMinutes: Math.round((e.totalMinutes / e.count) * 10) / 10,
        maxMinutes: Math.round(e.maxMinutes * 10) / 10,
      }))
      .sort((a, b) => a.station.localeCompare(b.station));

    const totalCount = rows.length;
    const avgMinutes = totalCount > 0 ? rows.reduce((sum, r) => sum + r.minutes, 0) / totalCount : 0;
    const maxMinutes = totalCount > 0 ? Math.max(...rows.map((r) => r.minutes)) : 0;

    res.json({
      range: { key: rangeKey, start: start.toUTC().toISO(), end: end.toUTC().toISO() },
      totalCount,
      avgMinutes: Math.round(avgMinutes * 10) / 10,
      maxMinutes: Math.round(maxMinutes * 10) / 10,
      byStation: byStationOut,
    });
  });

  // Balance Sheet — the only report backed by the general ledger (see
  // lib/ledger.js). Backfills any missing daily-close entries up through
  // the requested date on demand, so this never needs a separate "close the
  // books" admin action or cron job.
  router.get('/balance-sheet', requireAuth, (req, res) => {
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const date = typeof req.query.date === 'string' && req.query.date.trim() !== '' ? req.query.date : DateTime.now().setZone(tz).toISODate();
    if (!DateTime.fromISO(date).isValid) {
      return res.status(400).json({ error: 'date must be a valid YYYY-MM-DD date' });
    }
    res.json(getBalanceSheet(date));
  });

  // Statement of Cash Flows — also ledger-backed. `range` picks a calendar
  // window ending today, matching the convention every other report uses.
  router.get('/cash-flow', requireAuth, (req, res) => {
    const rangeKey = ['month', 'year'].includes(req.query.range) ? req.query.range : 'month';
    const tz = getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
    const { start, end } = resolveRange(rangeKey, tz);
    res.json(getCashFlow(start.toISODate(), end.toISODate()));
  });

  return router;
}

module.exports = { createReportsRouter };
