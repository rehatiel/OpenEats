const express = require('express');
const { DateTime } = require('luxon');
const { requireAuth } = require('../middleware/auth');

const VALID_RANGES = ['today', 'week', 'month'];

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

  return router;
}

module.exports = { createReportsRouter };
