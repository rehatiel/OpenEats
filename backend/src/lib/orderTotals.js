// Nets voids/comps/discounts out of an order's invoice amounts without
// mutating orders.subtotal/tax/total themselves — those stay the immutable
// gross figures reports.js's gross-sales numbers are built on. This computes
// "what the guest actually owes" as a layer on top, shared by orders.js
// (so GET responses expose it) and guestPayments.js (so checkout can't
// collect more than what's actually owed after adjustments).
function createOrderTotalsHelper(db) {
  const sumItemAdjustmentsForOrder = db.prepare(`
    SELECT COALESCE(SUM(oia.amount), 0) AS total
    FROM order_item_adjustments oia
    JOIN order_items oi ON oi.id = oia.order_item_id
    WHERE oi.order_id = ?
  `);
  const sumOrderAdjustmentsForOrder = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) AS total FROM order_adjustments WHERE order_id = ?'
  );

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  // Item-level adjustments are denominated pre-tax (against unit_price *
  // quantity), so they come off subtotal directly and carry their own tax
  // relief through the order's original effective tax rate. Order-level
  // adjustments (e.g. "10% off the whole check") are denominated post-tax
  // against the bill total, so they come off after tax is reapplied. Both
  // budgets are tracked independently of each other (see orders.js) so a
  // combination of the two could in theory exceed the gross total — clamped
  // at 0 here rather than allowed to go negative.
  function computeNetTotals(order) {
    const itemAdjustments = sumItemAdjustmentsForOrder.get(order.id).total;
    const orderAdjustments = sumOrderAdjustmentsForOrder.get(order.id).total;

    const netSubtotal = Math.max(0, order.subtotal - itemAdjustments);
    const taxRatio = order.subtotal > 0 ? order.tax / order.subtotal : 0;
    const netTaxBeforeOrderAdj = netSubtotal * taxRatio;
    const netTotalBeforeOrderAdj = netSubtotal + netTaxBeforeOrderAdj;
    const netTotal = Math.max(0, netTotalBeforeOrderAdj - orderAdjustments);
    const scale = netTotalBeforeOrderAdj > 0 ? netTotal / netTotalBeforeOrderAdj : 0;
    const roundedNetTotal = round2(netTotal);

    // adjustment_total is derived from the already-rounded net_total (not
    // independently rounded from the same raw value) so the two always
    // reconcile exactly against order.total to the cent.
    return {
      net_subtotal: round2(netSubtotal * scale),
      net_tax: round2(netTaxBeforeOrderAdj * scale),
      net_total: roundedNetTotal,
      adjustment_total: round2(order.total - roundedNetTotal),
    };
  }

  return { computeNetTotals };
}

module.exports = { createOrderTotalsHelper };
