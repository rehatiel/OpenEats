// Registry driving the generic /admin/reports/[slug] page — each entry
// describes how to fetch a report and reshape its (intentionally
// domain-correct, not force-fit-uniform) API response into either a flat
// table or a handful of summary stats. Adding a new report should mean
// adding one entry here, not a new bespoke page.
export type Cadence = 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Format = 'currency' | 'percent' | 'number' | 'text';

export interface ReportColumn {
  key: string;
  label: string;
  format?: Format;
}

export interface SummaryField {
  key: string;
  label: string;
  format?: Format;
}

export interface ReportEntry {
  slug: string;
  title: string;
  cadence: Cadence;
  description: string;
  endpoint: string;
  // Range keys this report accepts as ?range=; omit for range-less reports
  // (AP Aging is always a current snapshot; Daily Sales Summary takes a
  // ?date= instead, handled specially below).
  rangeOptions?: string[];
  defaultRange?: string;
  usesDateParam?: boolean;
  summaryFields?: SummaryField[];
  columns?: ReportColumn[];
  toRows?: (data: any) => Record<string, unknown>[];
  note?: (data: any) => string | null;
}

export const REPORTS: ReportEntry[] = [
  {
    slug: 'daily-sales-summary',
    title: 'Daily Sales Summary',
    cadence: 'daily',
    description: 'Gross/net revenue, tax, and sales by category for a single day.',
    endpoint: '/api/reports/daily-sales-summary',
    usesDateParam: true,
    summaryFields: [
      { key: 'grossRevenue', label: 'Gross revenue', format: 'currency' },
      { key: 'taxCollected', label: 'Tax collected', format: 'currency' },
      { key: 'adjustments', label: 'Voids/comps/discounts', format: 'currency' },
      { key: 'netRevenue', label: 'Net revenue', format: 'currency' },
      { key: 'orders', label: 'Orders', format: 'number' },
    ],
    columns: [
      { key: 'taxCategory', label: 'Category', format: 'text' },
      { key: 'sales', label: 'Sales', format: 'currency' },
    ],
    toRows: (data) => data.salesByCategory,
    note: (data) => data.note ?? null,
  },
  {
    slug: 'tender-reconciliation',
    title: 'Tender / Payment Reconciliation',
    cadence: 'daily',
    description: 'Cash vs. card collected, tips, and card fees vs. expected bank deposit.',
    endpoint: '/api/reports/tender-reconciliation',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'today',
    summaryFields: [
      { key: 'cash', label: 'Cash', format: 'currency' },
      { key: 'card', label: 'Card', format: 'currency' },
      { key: 'tips', label: 'Tips', format: 'currency' },
      { key: 'ccFees', label: 'Card processing fees', format: 'currency' },
      { key: 'paymentCount', label: 'Payments', format: 'number' },
    ],
  },
  {
    slug: 'product-mix',
    title: 'Product Mix (P-Mix)',
    cadence: 'daily',
    description: 'Quantity and sales value for every menu item.',
    endpoint: '/api/reports/product-mix',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'week',
    columns: [
      { key: 'name', label: 'Item', format: 'text' },
      { key: 'price', label: 'Price', format: 'currency' },
      { key: 'sold', label: 'Sold', format: 'number' },
      { key: 'salesValue', label: 'Sales', format: 'currency' },
      { key: 'pctOfSales', label: '% of sales', format: 'percent' },
      { key: 'marginPct', label: 'Margin', format: 'percent' },
    ],
    toRows: (data) => data.items,
  },
  {
    slug: 'voids-comps-discounts',
    title: 'Voids, Comps & Discounts',
    cadence: 'daily',
    description: 'Every manager-authorized adjustment, with who initiated and who approved it.',
    endpoint: '/api/reports/voids-comps-discounts',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'week',
    columns: [
      { key: 'created_at', label: 'When', format: 'text' },
      { key: 'type', label: 'Type', format: 'text' },
      { key: 'scope', label: 'Scope', format: 'text' },
      { key: 'order_id', label: 'Order', format: 'number' },
      { key: 'amount', label: 'Amount', format: 'currency' },
      { key: 'reason', label: 'Reason', format: 'text' },
      { key: 'created_by_name', label: 'Initiated by', format: 'text' },
      { key: 'authorized_by_name', label: 'Authorized by', format: 'text' },
    ],
    toRows: (data) => data.entries,
  },
  {
    slug: 'labor-cost',
    title: 'Labor Cost & Punch Report',
    cadence: 'daily',
    description: 'Hours and cost per employee, priced at the wage rate in effect on the punch date.',
    endpoint: '/api/reports/labor-cost',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'week',
    summaryFields: [
      { key: 'totalHours', label: 'Total hours', format: 'number' },
      { key: 'totalCost', label: 'Total labor cost', format: 'currency' },
      { key: 'laborCostPct', label: 'Labor cost % of net sales', format: 'percent' },
    ],
    columns: [
      { key: 'name', label: 'Employee', format: 'text' },
      { key: 'hours', label: 'Hours', format: 'number' },
      { key: 'cost', label: 'Cost', format: 'currency' },
    ],
    toRows: (data) => data.byEmployee,
    note: (data) => data.note ?? null,
  },
  {
    slug: 'weekly-flash-pnl',
    title: 'Weekly Flash Report',
    cadence: 'weekly',
    description: 'A fast, approximate P&L snapshot to track weekly trend — not for tax/accounting purposes.',
    endpoint: '/api/reports/weekly-flash-pnl',
    summaryFields: [
      { key: 'grossSales', label: 'Gross sales', format: 'currency' },
      { key: 'adjustments', label: 'Voids/comps/discounts', format: 'currency' },
      { key: 'netSales', label: 'Net sales', format: 'currency' },
      { key: 'foodCost', label: 'Food cost', format: 'currency' },
      { key: 'grossProfit', label: 'Gross profit', format: 'currency' },
      { key: 'grossProfitMarginPct', label: 'Margin', format: 'percent' },
      { key: 'orders', label: 'Orders', format: 'number' },
    ],
  },
  {
    slug: 'labor-variance',
    title: 'Labor Variance Report',
    cadence: 'weekly',
    description: 'Scheduled vs. actual hours and cost per employee.',
    endpoint: '/api/reports/labor-variance',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'week',
    summaryFields: [
      { key: 'totalScheduledHours', label: 'Scheduled hours', format: 'number' },
      { key: 'totalActualHours', label: 'Actual hours', format: 'number' },
      { key: 'totalScheduledCost', label: 'Scheduled cost', format: 'currency' },
      { key: 'totalActualCost', label: 'Actual cost', format: 'currency' },
    ],
    columns: [
      { key: 'name', label: 'Employee', format: 'text' },
      { key: 'scheduledHours', label: 'Scheduled hrs', format: 'number' },
      { key: 'actualHours', label: 'Actual hrs', format: 'number' },
      { key: 'hoursVariance', label: 'Hrs variance', format: 'number' },
      { key: 'costVariance', label: 'Cost variance', format: 'currency' },
    ],
    toRows: (data) => data.byEmployee,
    note: (data) => data.note ?? null,
  },
  {
    slug: 'order-ready-efficiency',
    title: 'Order-Ready Efficiency',
    cadence: 'daily',
    description: 'How long ready tickets sit before staff dismiss the alert, by station — measures service pickup speed.',
    endpoint: '/api/reports/order-efficiency',
    rangeOptions: ['today', 'week', 'month'],
    defaultRange: 'week',
    summaryFields: [
      { key: 'totalCount', label: 'Tickets acknowledged', format: 'number' },
      { key: 'avgMinutes', label: 'Avg wait (min)', format: 'number' },
      { key: 'maxMinutes', label: 'Longest wait (min)', format: 'number' },
    ],
    columns: [
      { key: 'station', label: 'Station', format: 'text' },
      { key: 'count', label: 'Tickets', format: 'number' },
      { key: 'avgMinutes', label: 'Avg wait (min)', format: 'number' },
      { key: 'maxMinutes', label: 'Longest wait (min)', format: 'number' },
    ],
    toRows: (data) => data.byStation,
  },
  {
    slug: 'cogs-variance',
    title: 'COGS & Inventory Variance',
    cadence: 'weekly',
    description: 'Dollar variance found by physical inventory counts recorded in the period.',
    endpoint: '/api/reports/cogs-variance',
    rangeOptions: ['week', 'month'],
    defaultRange: 'month',
    columns: [
      { key: 'name', label: 'Ingredient', format: 'text' },
      { key: 'unit', label: 'Unit', format: 'text' },
      { key: 'totalVariance', label: 'Variance (qty)', format: 'number' },
      { key: 'varianceValue', label: 'Variance ($)', format: 'currency' },
    ],
    toRows: (data) => data.ingredients,
  },
  {
    slug: 'ap-aging',
    title: 'AP Aging',
    cadence: 'weekly',
    description: 'Open vendor invoices, bucketed by days overdue. Always a current snapshot.',
    endpoint: '/api/reports/ap-aging',
    columns: [
      { key: 'vendor_name', label: 'Vendor', format: 'text' },
      { key: 'invoice_number', label: 'Invoice #', format: 'text' },
      { key: 'due_date', label: 'Due', format: 'text' },
      { key: 'bucket', label: 'Bucket', format: 'text' },
      { key: 'days_overdue', label: 'Days overdue', format: 'number' },
      { key: 'amount', label: 'Amount', format: 'currency' },
    ],
    toRows: (data) =>
      Object.entries(data.buckets).flatMap(([bucket, invoices]) =>
        (invoices as Record<string, unknown>[]).map((inv) => ({ ...inv, bucket }))
      ),
  },
  {
    slug: 'monthly-pnl',
    title: 'Monthly Sales & Gross Profit',
    cadence: 'monthly',
    description: 'Sales/COGS/gross-profit summary for the month. Not a full P&L — see note.',
    endpoint: '/api/reports/sales-summary',
    rangeOptions: ['month', 'year'],
    defaultRange: 'month',
    summaryFields: [
      { key: 'grossSales', label: 'Gross sales', format: 'currency' },
      { key: 'adjustments', label: 'Voids/comps/discounts', format: 'currency' },
      { key: 'netSales', label: 'Net sales', format: 'currency' },
      { key: 'foodCost', label: 'Food cost', format: 'currency' },
      { key: 'grossProfit', label: 'Gross profit', format: 'currency' },
      { key: 'grossProfitMarginPct', label: 'Margin', format: 'percent' },
      { key: 'tips', label: 'Tips', format: 'currency' },
      { key: 'ccFees', label: 'Card processing fees', format: 'currency' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'avgTicket', label: 'Avg ticket', format: 'currency' },
    ],
    note: (data) => data.note ?? null,
  },
  {
    slug: 'annual-financials',
    title: 'Annual Financials',
    cadence: 'yearly',
    description: 'Sales/COGS/gross-profit summary for the year. Not audited financial statements — see note.',
    endpoint: '/api/reports/sales-summary',
    rangeOptions: ['year'],
    defaultRange: 'year',
    summaryFields: [
      { key: 'grossSales', label: 'Gross sales', format: 'currency' },
      { key: 'adjustments', label: 'Voids/comps/discounts', format: 'currency' },
      { key: 'netSales', label: 'Net sales', format: 'currency' },
      { key: 'foodCost', label: 'Food cost', format: 'currency' },
      { key: 'grossProfit', label: 'Gross profit', format: 'currency' },
      { key: 'grossProfitMarginPct', label: 'Margin', format: 'percent' },
      { key: 'orders', label: 'Orders', format: 'number' },
    ],
    note: (data) => data.note ?? null,
  },
  {
    slug: 'menu-engineering',
    title: 'Menu Engineering Matrix',
    cadence: 'monthly',
    description: 'Classifies items into Stars / Plowhorses / Puzzles / Dogs by popularity vs. margin.',
    endpoint: '/api/reports/menu-engineering',
    rangeOptions: ['week', 'month'],
    defaultRange: 'month',
    columns: [
      { key: 'name', label: 'Item', format: 'text' },
      { key: 'sold', label: 'Sold', format: 'number' },
      { key: 'marginPct', label: 'Margin', format: 'percent' },
      { key: 'classification', label: 'Classification', format: 'text' },
    ],
    toRows: (data) => data.items,
  },
  {
    slug: 'yoy-comparison',
    title: 'Year-over-Year Comparison',
    cadence: 'yearly',
    description: "This period vs. the same period one year earlier.",
    endpoint: '/api/reports/yoy',
    rangeOptions: ['month', 'year'],
    defaultRange: 'year',
    columns: [
      { key: 'period', label: 'Period', format: 'text' },
      { key: 'grossSales', label: 'Gross sales', format: 'currency' },
      { key: 'orders', label: 'Orders', format: 'number' },
      { key: 'avgTicket', label: 'Avg ticket', format: 'currency' },
    ],
    toRows: (data) => [
      { period: 'This period', ...data.current },
      { period: 'Same period last year', ...data.prior },
    ],
  },
  {
    slug: 'balance-sheet',
    title: 'Balance Sheet',
    cadence: 'monthly',
    description: 'Assets, liabilities, and equity as of a given date, from the general ledger.',
    endpoint: '/api/reports/balance-sheet',
    usesDateParam: true,
    summaryFields: [
      { key: 'totalAssets', label: 'Total assets', format: 'currency' },
      { key: 'totalLiabilities', label: 'Total liabilities', format: 'currency' },
      { key: 'totalEquity', label: 'Total equity', format: 'currency' },
    ],
    columns: [
      { key: 'line', label: 'Line', format: 'text' },
      { key: 'amount', label: 'Amount', format: 'currency' },
    ],
    toRows: (data) => [
      { line: 'Cash and cash equivalents', amount: data.assets.cash },
      { line: 'Accounts receivable (guest checks)', amount: data.assets.accountsReceivable },
      { line: 'Inventory', amount: data.assets.inventory },
      { line: 'Fixed assets (gross)', amount: data.assets.fixedAssetsGross },
      { line: 'Accumulated depreciation', amount: data.assets.accumulatedDepreciation },
      { line: 'Fixed assets (net)', amount: data.assets.fixedAssetsNet },
      { line: 'Accounts payable', amount: data.liabilities.accountsPayable },
      { line: 'Sales tax payable', amount: data.liabilities.salesTaxPayable },
      { line: 'Tips payable', amount: data.liabilities.tipsPayable },
      { line: 'Retained earnings', amount: data.equity.retainedEarnings },
    ],
    note: (data) => data.note ?? null,
  },
  {
    slug: 'cash-flow',
    title: 'Statement of Cash Flows',
    cadence: 'monthly',
    description: 'Operating and investing cash movement for the period, from the general ledger.',
    endpoint: '/api/reports/cash-flow',
    rangeOptions: ['month', 'year'],
    defaultRange: 'month',
    summaryFields: [
      { key: 'operatingActivities', label: 'Operating activities', format: 'currency' },
      { key: 'investingActivities', label: 'Investing activities', format: 'currency' },
      { key: 'financingActivities', label: 'Financing activities', format: 'currency' },
      { key: 'netChangeInCash', label: 'Net change in cash', format: 'currency' },
    ],
  },
  {
    slug: 'capex-log',
    title: 'CapEx Log',
    cadence: 'yearly',
    description: 'Long-lived asset purchases (equipment, renovations, software).',
    endpoint: '/api/capex',
    columns: [
      { key: 'description', label: 'Description', format: 'text' },
      { key: 'category', label: 'Category', format: 'text' },
      { key: 'purchase_date', label: 'Purchased', format: 'text' },
      { key: 'amount', label: 'Amount', format: 'currency' },
      { key: 'vendor_name', label: 'Vendor', format: 'text' },
    ],
    toRows: (data) => data,
  },
];

export function getReport(slug: string): ReportEntry | undefined {
  return REPORTS.find((r) => r.slug === slug);
}

export function formatValue(value: unknown, format?: Format): string {
  if (value === null || value === undefined) return '—';
  if (format === 'currency' && typeof value === 'number') return `$${value.toFixed(2)}`;
  if (format === 'percent' && typeof value === 'number') return `${value.toFixed(1)}%`;
  if (format === 'number' && typeof value === 'number') return value.toLocaleString();
  return String(value);
}
