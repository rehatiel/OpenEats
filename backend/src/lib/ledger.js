const { DateTime } = require('luxon');
const { createOrderTotalsHelper } = require('./orderTotals');

// A minimal double-entry ledger, built to support exactly two reports —
// Balance Sheet and Cash Flow — that structurally need point-in-time
// account balances. Every other financial report in this app reads its own
// purpose-built subledger directly (guest_payments, order_item_adjustments,
// vendor_invoices, ...) rather than going through here; see reports.js.
//
// CHART OF ACCOUNTS (seeded in db/init.js's seedChartOfAccounts):
//   1000 Cash and Cash Equivalents      asset
//   1050 Accounts Receivable (Guest Checks)  asset
//   1200 Inventory                      asset
//   1500 Fixed Assets                   asset
//   2000 Accounts Payable               liability
//   2100 Sales Tax Payable              liability
//   2200 Tips Payable                   liability
//   3000 Retained Earnings              equity   (never posted to directly —
//        see getBalanceSheet; kept only so an account exists to hold a
//        future manual equity adjustment, e.g. an owner contribution)
//   4000 Sales Revenue                  revenue  (one line, not split by
//        category — the ledger only needs to balance the sheet, not
//        reproduce the P-Mix/DSS category breakdown those reports already
//        own)
//   5000 Cost of Goods Sold             expense
//   5900 Operating Expenses             expense  (every vendor invoice books
//        here — vendor_invoices has no expense-category field yet, and this
//        ledger deliberately doesn't invent a taxonomy to sort them into)
//
// DAILY CLOSE (source='daily_close', one entry per business day, posted by
// postDailyClose / backfilled by ensureDailyClosesThrough):
//   Revenue/tax/COGS are recognized on ACCRUAL basis (order.timestamp) —
//   the same basis every other report (DSS, weekly flash, sales-summary)
//   already uses, and always net-of-adjustment via computeNetTotals (the
//   same helper checkout's guest-payments guard uses) — using a different
//   basis or a gross figure here would make the Balance Sheet disagree with
//   the P&L-ish reports for reasons that have nothing to do with the
//   business, exactly the class of bug the checkout-adjustment fix closed.
//   Cash/tips are recognized on CASH basis (guest_payments.paid_at), since
//   there is no "tip accrual" — a tip is a cash event or it's nothing.
//
//   Lines posted for day D:
//     Dr 1000 Cash            billCash   (cash_amount+card_amount collected)
//     Dr/Cr 1050 A/R          plug       (see below)
//     Cr 4000 Sales Revenue   netRevenue (sum of net_subtotal, day-D orders)
//     Cr 2100 Sales Tax Pay.  netTax     (sum of net_tax, day-D orders)
//     Dr 5000 COGS            cogs       (sum of calculated_food_cost)
//     Cr 1200 Inventory       cogs
//     Dr 1000 Cash            tips       (sum of tip_amount, day-D payments)
//     Cr 2200 Tips Payable    tips
//
//   plug = netRevenue + netTax - billCash: the gap between what was
//   recognized as owed today (accrual) and what was actually collected
//   today (cash). Positive → some of today's sales are still unpaid (new
//   receivable, Dr 1050). Negative → today's cash includes settling an
//   older day's unpaid tab (receivable relieved, Cr 1050). This is the only
//   scenario where A/R is ever nonzero — a restaurant where every guest pays
//   before leaving will post a $0 (omitted) A/R line every day.
//
//   CC processing fees are deliberately NOT posted anywhere: checkout
//   charges the guest exactly cc_fee_percent on top of the bill as a
//   pass-through reimbursement, so — absent a real payment-processor
//   integration that could reveal an actual fee different from what was
//   charged — modeling it nets to zero on both cash and income. If a real
//   processor integration is ever added, that's where a fee-expense/
//   fee-recovery pair would need to appear.
//
// PER-EVENT ENTRIES:
//   vendor_invoice (on creation): Dr 5900 Operating Expenses / Cr 2000 A/P
//   vendor_invoice_payment (on status -> paid): Dr 2000 A/P / Cr 1000 Cash
//   capex (on creation): Dr 1500 Fixed Assets / Cr 1000 Cash — assumes paid
//     on purchase; capex_items has no separate financed/invoiced flow yet.
//
// DEPRECIATION is never posted as a journal entry — it's derived at
// Balance-Sheet-render time (straight-line over useful_life_months from
// purchase_date), the same "always a current snapshot, never stored"
// treatment AP Aging already uses. This sidesteps needing a monthly
// depreciation-posting job and its idempotency bookkeeping entirely.
//
// EQUITY / RETAINED EARNINGS: there is no formal period-close step that
// zeroes revenue/expense accounts into equity at fiscal year end. Instead,
// Retained Earnings is computed as life-to-date net income (all revenue
// minus all expense account balances, including derived depreciation) plus
// whatever's actually posted to account 3000. This is what makes
// Assets = Liabilities + Equity hold by construction — it's the accounting
// equation, not a plug fitted after the fact.
function createLedgerHelper(db) {
  const { computeNetTotals } = createOrderTotalsHelper(db);

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  const getAccountIdByCode = db.prepare('SELECT id FROM chart_of_accounts WHERE code = ?');
  const accountCache = new Map();
  function accountId(code) {
    if (!accountCache.has(code)) {
      const row = getAccountIdByCode.get(code);
      if (!row) throw new Error(`chart_of_accounts is missing account ${code}`);
      accountCache.set(code, row.id);
    }
    return accountCache.get(code);
  }

  const insertEntry = db.prepare('INSERT INTO journal_entries (entry_date, source, source_id, memo) VALUES (?, ?, ?, ?)');
  const insertLine = db.prepare('INSERT INTO journal_lines (entry_id, account_id, debit, credit) VALUES (?, ?, ?, ?)');

  // Posts one balanced multi-line entry. Balance is checked against the
  // FULL (unfiltered) line set — not the near-zero-trimmed set actually
  // inserted — so a sub-cent line that gets dropped for being pointless to
  // store can never be mistaken for a real imbalance. Refuses to commit
  // (throws) if debits and credits don't agree to the cent, since a silent
  // imbalance here would corrupt every downstream Balance Sheet/Cash Flow.
  function postEntry({ entryDate, source, sourceId = null, memo = null, lines }) {
    const totalDebit = lines.reduce((sum, l) => sum + (l.debit ?? 0), 0);
    const totalCredit = lines.reduce((sum, l) => sum + (l.credit ?? 0), 0);
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(
        `refusing to post unbalanced journal entry (source=${source}, date=${entryDate}): debits ${totalDebit.toFixed(2)} != credits ${totalCredit.toFixed(2)}`
      );
    }

    const usableLines = lines.filter((l) => Math.abs(l.debit ?? 0) > 0.004 || Math.abs(l.credit ?? 0) > 0.004);
    if (usableLines.length === 0) return null;

    return db.transaction(() => {
      const { lastInsertRowid: entryId } = insertEntry.run(entryDate, source, sourceId, memo ?? null);
      for (const line of usableLines) {
        insertLine.run(entryId, accountId(line.code), round2(line.debit ?? 0), round2(line.credit ?? 0));
      }
      return entryId;
    })();
  }

  const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?');
  function getTz() {
    return getSetting.get('restaurant_timezone')?.value || 'America/Chicago';
  }
  function toSqlTimestamp(dt) {
    return dt.toUTC().toFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'");
  }

  const hasDailyClose = db.prepare("SELECT 1 FROM journal_entries WHERE source = 'daily_close' AND entry_date = ?");
  const ordersForDay = db.prepare(
    'SELECT id, subtotal, tax, total, calculated_food_cost FROM orders WHERE timestamp >= ? AND timestamp < ?'
  );
  const paymentsForDay = db.prepare(`
    SELECT COALESCE(SUM(cash_amount + card_amount), 0) AS billCash, COALESCE(SUM(tip_amount), 0) AS tips
    FROM guest_payments
    WHERE paid_at >= ? AND paid_at < ?
  `);
  const earliestOrderTimestampStmt = db.prepare('SELECT MIN(timestamp) AS t FROM orders');
  const latestDailyCloseDateStmt = db.prepare("SELECT MAX(entry_date) AS d FROM journal_entries WHERE source = 'daily_close'");

  function postDailyClose(dateStr) {
    if (hasDailyClose.get(dateStr)) return null;

    const tz = getTz();
    const today = DateTime.now().setZone(tz).toISODate();
    if (dateStr >= today) return null; // never close today-in-progress or a future date

    const start = DateTime.fromISO(dateStr, { zone: tz }).startOf('day');
    const end = start.plus({ days: 1 });
    const startSql = toSqlTimestamp(start);
    const endSql = toSqlTimestamp(end);

    let netRevenue = 0;
    let netTax = 0;
    let cogs = 0;
    for (const order of ordersForDay.all(startSql, endSql)) {
      const net = computeNetTotals(order);
      netRevenue += net.net_subtotal;
      netTax += net.net_tax;
      cogs += order.calculated_food_cost;
    }
    const { billCash, tips } = paymentsForDay.get(startSql, endSql);
    const plug = round2(netRevenue + netTax - billCash);

    return postEntry({
      entryDate: dateStr,
      source: 'daily_close',
      memo: `Daily close for ${dateStr}`,
      lines: [
        { code: '1000', debit: billCash },
        plug >= 0 ? { code: '1050', debit: plug } : { code: '1050', credit: -plug },
        { code: '4000', credit: netRevenue },
        { code: '2100', credit: netTax },
        { code: '5000', debit: cogs },
        { code: '1200', credit: cogs },
        { code: '1000', debit: tips },
        { code: '2200', credit: tips },
      ],
    });
  }

  // Backfills every missing daily-close entry, from the day after the last
  // one posted (or the earliest order on record, if none exist yet) through
  // the most recent fully-closed day — so Balance Sheet/Cash Flow stay
  // current without a separate cron job or admin "close the books" button.
  function ensureDailyClosesThrough(throughDateStr) {
    const tz = getTz();
    const lastClosableDate = DateTime.now().setZone(tz).minus({ days: 1 }).toISODate();
    const targetDate = throughDateStr < lastClosableDate ? throughDateStr : lastClosableDate;

    const latest = latestDailyCloseDateStmt.get().d;
    let cursor;
    if (latest) {
      cursor = DateTime.fromISO(latest, { zone: tz }).plus({ days: 1 });
    } else {
      const earliest = earliestOrderTimestampStmt.get().t;
      if (!earliest) return; // no orders ever placed — nothing to close
      cursor = DateTime.fromISO(earliest, { zone: 'utc' }).setZone(tz).startOf('day');
    }

    const target = DateTime.fromISO(targetDate, { zone: tz });
    while (cursor <= target) {
      postDailyClose(cursor.toISODate());
      cursor = cursor.plus({ days: 1 });
    }
  }

  function postVendorInvoiceCreated(invoice) {
    postEntry({
      entryDate: invoice.invoice_date,
      source: 'vendor_invoice',
      sourceId: invoice.id,
      memo: `Invoice ${invoice.invoice_number}`,
      lines: [
        { code: '5900', debit: invoice.amount },
        { code: '2000', credit: invoice.amount },
      ],
    });
  }

  function postVendorInvoicePaid(invoice, paidDate) {
    postEntry({
      entryDate: paidDate,
      source: 'vendor_invoice_payment',
      sourceId: invoice.id,
      memo: `Payment on invoice ${invoice.invoice_number}`,
      lines: [
        { code: '2000', debit: invoice.amount },
        { code: '1000', credit: invoice.amount },
      ],
    });
  }

  function postCapexCreated(capexItem) {
    postEntry({
      entryDate: capexItem.purchase_date,
      source: 'capex',
      sourceId: capexItem.id,
      memo: capexItem.description,
      lines: [
        { code: '1500', debit: capexItem.amount },
        { code: '1000', credit: capexItem.amount },
      ],
    });
  }

  const accountBalancesThrough = db.prepare(`
    SELECT coa.code, coa.name, coa.type, coa.normal_balance,
           COALESCE(SUM(jl.debit), 0) AS totalDebit,
           COALESCE(SUM(jl.credit), 0) AS totalCredit
    FROM chart_of_accounts coa
    LEFT JOIN journal_lines jl ON jl.account_id = coa.id
      AND jl.entry_id IN (SELECT id FROM journal_entries WHERE entry_date <= ?)
    GROUP BY coa.id
  `);

  const capexForDepreciation = db.prepare(
    'SELECT amount, purchase_date, useful_life_months FROM capex_items WHERE useful_life_months IS NOT NULL AND useful_life_months > 0'
  );

  // Straight-line, capped at each item's full amount once its useful life
  // has elapsed — never derives a negative or over-100%-depreciated figure.
  function accumulatedDepreciation(asOfDateStr) {
    const asOf = DateTime.fromISO(asOfDateStr);
    let total = 0;
    for (const item of capexForDepreciation.all()) {
      const purchase = DateTime.fromISO(item.purchase_date);
      const monthsElapsed = Math.max(0, asOf.diff(purchase, 'months').months);
      const monthsToUse = Math.min(item.useful_life_months, monthsElapsed);
      total += (item.amount / item.useful_life_months) * monthsToUse;
    }
    return round2(total);
  }

  function getBalanceSheet(asOfDateStr) {
    ensureDailyClosesThrough(asOfDateStr);

    const byCode = {};
    for (const row of accountBalancesThrough.all(asOfDateStr)) {
      byCode[row.code] = row.normal_balance === 'debit' ? round2(row.totalDebit - row.totalCredit) : round2(row.totalCredit - row.totalDebit);
    }
    const get = (code) => byCode[code] ?? 0;

    const accumDep = accumulatedDepreciation(asOfDateStr);
    const fixedAssetsGross = get('1500');
    const fixedAssetsNet = round2(fixedAssetsGross - accumDep);

    const assets = {
      cash: get('1000'),
      accountsReceivable: get('1050'),
      inventory: get('1200'),
      fixedAssetsGross,
      accumulatedDepreciation: round2(-accumDep),
      fixedAssetsNet,
    };
    const totalAssets = round2(assets.cash + assets.accountsReceivable + assets.inventory + assets.fixedAssetsNet);

    const liabilities = {
      accountsPayable: get('2000'),
      salesTaxPayable: get('2100'),
      tipsPayable: get('2200'),
    };
    const totalLiabilities = round2(liabilities.accountsPayable + liabilities.salesTaxPayable + liabilities.tipsPayable);

    const revenue = get('4000');
    const expenses = round2(get('5000') + get('5900') + accumDep);
    const retainedEarnings = round2(revenue - expenses + get('3000'));
    const totalEquity = retainedEarnings;

    return {
      asOf: asOfDateStr,
      assets,
      totalAssets,
      liabilities,
      totalLiabilities,
      equity: { retainedEarnings },
      totalEquity,
      // Should always be ~0 by construction (every posted entry balances) —
      // a nonzero value here would mean a bug in this module, not the data.
      imbalance: round2(totalAssets - totalLiabilities - totalEquity),
      note: 'Depreciation is derived here, not posted to the ledger. Retained earnings is life-to-date net income — there is no formal period-close.',
    };
  }

  const cashLinesInRange = db.prepare(`
    SELECT je.source, jl.debit, jl.credit
    FROM journal_lines jl
    JOIN journal_entries je ON je.id = jl.entry_id
    JOIN chart_of_accounts coa ON coa.id = jl.account_id
    WHERE coa.code = '1000' AND je.entry_date >= ? AND je.entry_date < ?
  `);

  function getCashFlow(startDateStr, endDateStr) {
    ensureDailyClosesThrough(endDateStr);

    let operating = 0;
    let investing = 0;
    for (const row of cashLinesInRange.all(startDateStr, endDateStr)) {
      const net = row.debit - row.credit;
      if (row.source === 'capex') investing += net;
      else operating += net; // daily_close, vendor_invoice_payment
    }
    return {
      start: startDateStr,
      end: endDateStr,
      operatingActivities: round2(operating),
      investingActivities: round2(investing),
      financingActivities: 0,
      netChangeInCash: round2(operating + investing),
    };
  }

  return {
    postEntry,
    postDailyClose,
    ensureDailyClosesThrough,
    postVendorInvoiceCreated,
    postVendorInvoicePaid,
    postCapexCreated,
    getBalanceSheet,
    getCashFlow,
  };
}

module.exports = { createLedgerHelper };
