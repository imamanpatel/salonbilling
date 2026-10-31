import { formatINR } from '@salon/shared';
import { COLLECTION_METHODS, ITEM_KIND_LABELS, METHOD_LABELS, PAYMENT_KIND_LABELS, REDEMPTION_METHODS, SALES_KINDS } from '@salon/shared/reports';
import { Badge, Card, CardHeader } from '../../components/ui.jsx';
import { ENQUIRY_STATUS_LABELS, ENQUIRY_TYPE_LABELS, formatDate, formatDateTime, LEAD_SOURCE_LABELS } from '../../lib/format.js';
import { BarChart, ReportTable, Tile } from './components.jsx';

// One view per report; each receives the endpoint's `data`.

const money = (key, header, value) => ({ key, header, money: true, value });
const sourceLabel = (source) => LEAD_SOURCE_LABELS[source] ?? 'Not set';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

function DailySummary({ data }) {
  const columns = [
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (r) => formatDate(r.date) },
    { key: 'bills', header: 'Bills', numeric: true },
    money('gross', 'Gross', (r) => r.grossPaise),
    money('discount', 'Discount', (r) => r.discountPaise),
    money('tax', 'Tax', (r) => r.taxPaise),
    money('net', 'Net sales', (r) => r.netPaise),
    ...SALES_KINDS.map((k) => money(`kind-${k}`, ITEM_KIND_LABELS[k], (r) => r.byKind[k])),
    ...COLLECTION_METHODS.map((m) => money(`method-${m}`, METHOD_LABELS[m], (r) => r.collections[m])),
    money('collected', 'Collected', (r) => r.collectedPaise),
    ...REDEMPTION_METHODS.map((m) => money(`redeemed-${m}`, `${METHOD_LABELS[m]} used`, (r) => r.redemptions[m])),
    money('dues', 'Dues created', (r) => r.duesCreatedPaise),
  ];
  const { totals } = data;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Net sales" value={formatINR(totals.netPaise)} hint={plural(totals.bills, 'bill')} />
        <Tile label="Cash collected" value={formatINR(totals.collectedPaise)} hint="Cash, card, UPI, bank, cheque" />
        <Tile label="Wallet & gift cards used" value={formatINR(totals.redemptions.WALLET + totals.redemptions.GIFT_CARD)} hint="Not counted as collected" />
        <Tile label="Dues created" value={formatINR(totals.duesCreatedPaise)} />
      </div>
      <Card>
        <CardHeader title="Net sales per day" />
        <div className="p-5">
          <BarChart
            label="Net sales per day"
            bars={data.rows.map((r) => ({ key: r.date, value: r.netPaise, title: `${formatDate(r.date)}: ${formatINR(r.netPaise)} · ${plural(r.bills, 'bill')}` }))}
            startLabel={formatDate(data.from)}
            endLabel={formatDate(data.to)}
          />
        </div>
      </Card>
      <Card>
        <ReportTable columns={columns} rows={data.rows} totals={totals} rowKey={(r) => r.date} />
      </Card>
    </>
  );
}

function SalesByItem({ data }) {
  const columns = [
    { key: 'name', header: 'Item', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'kind', header: 'Type', render: (r) => <Badge>{ITEM_KIND_LABELS[r.kind]}</Badge>, total: false },
    { key: 'qty', header: 'Qty', numeric: true },
    money('gross', 'Gross', (r) => r.grossPaise),
    money('discount', 'Discount', (r) => r.discountPaise),
    money('taxable', 'Taxable', (r) => r.taxablePaise),
    money('tax', 'Tax', (r) => r.taxPaise),
    money('total', 'Total', (r) => r.totalPaise),
  ];
  return (
    <Card>
      <ReportTable columns={columns} rows={data.rows} totals={data.totals} rowKey={(r) => r.key} />
    </Card>
  );
}

function Staff({ data }) {
  const columns = [
    { key: 'name', header: 'Staff', render: (r) => <span className="font-medium text-slate-900">{r.name}</span> },
    { key: 'services', header: 'Services', numeric: true },
    money('serviceSales', 'Service sales', (r) => r.serviceSalesPaise),
    money('productSales', 'Product sales', (r) => r.productSalesPaise),
    money('commission', 'Commission', (r) => r.commissionPaise),
    { key: 'bills', header: 'Bills', numeric: true },
  ];
  return (
    <Card>
      <CardHeader title="Staff performance" description="Sales are taxable amounts (after discounts, before tax)." />
      <ReportTable columns={columns} rows={data.rows} totals={data.totals} rowKey={(r) => r.staffId} />
    </Card>
  );
}

function Collections({ data }) {
  const { totals } = data;
  const columns = [
    { key: 'receivedAt', header: 'Received', className: 'whitespace-nowrap', render: (r) => formatDateTime(r.receivedAt) },
    { key: 'billNumber', header: 'Bill', className: 'whitespace-nowrap' },
    { key: 'clientName', header: 'Client' },
    { key: 'kind', header: 'Type', render: (r) => PAYMENT_KIND_LABELS[r.kind] },
    {
      key: 'method',
      header: 'Method',
      render: (r) => <Badge tone={REDEMPTION_METHODS.includes(r.method) ? 'amber' : 'slate'}>{METHOD_LABELS[r.method]}</Badge>,
    },
    money('amount', 'Amount', (r) => r.amountPaise),
    { key: 'reference', header: 'Reference' },
  ];
  const methods = Object.keys(totals.byMethod).filter((m) => totals.byMethod[m] > 0);
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Cash collected" value={formatINR(totals.collectedPaise)} hint={plural(totals.count, 'payment')} />
        <Tile label="Wallet used" value={formatINR(totals.byMethod.WALLET)} hint="Redemption, not collected" />
        <Tile label="Gift cards used" value={formatINR(totals.byMethod.GIFT_CARD)} hint="Redemption, not collected" />
      </div>
      {methods.length > 0 && (
        <Card>
          <CardHeader title="By method" />
          <ul className="grid gap-x-6 gap-y-2 px-5 py-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {methods.map((m) => (
              <li key={m} className="flex justify-between gap-3">
                <span className="text-slate-500">{METHOD_LABELS[m]}</span>
                <span className="font-medium text-slate-900 tabular-nums">{formatINR(totals.byMethod[m])}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card>
        <ReportTable columns={columns} rows={data.rows} totals={{ amountPaise: totals.totalPaise }} empty="No payments in this period." />
      </Card>
    </>
  );
}

function Dues({ data }) {
  const columns = [
    { key: 'number', header: 'Bill', className: 'whitespace-nowrap' },
    { key: 'date', header: 'Date', className: 'whitespace-nowrap', render: (r) => formatDate(r.date) },
    {
      key: 'client',
      header: 'Client',
      render: (r) => (
        <>
          <span className="block font-medium text-slate-900">{r.clientName}</span>
          <span className="block text-xs text-slate-500">{r.clientPhone}</span>
        </>
      ),
    },
    money('total', 'Bill total', (r) => r.totalPaise),
    money('paid', 'Paid', (r) => r.paidPaise),
    money('due', 'Due', (r) => r.duePaise),
    { key: 'ageDays', header: 'Age (days)', numeric: true, total: false },
  ];
  return (
    <Card>
      <CardHeader title="Outstanding dues" description={`${plural(data.totals.count, 'bill')} with money still to collect, oldest first.`} />
      <ReportTable columns={columns} rows={data.rows} totals={data.totals} rowKey={(r) => r.billId} empty="No dues outstanding." />
    </Card>
  );
}

function Clients({ data }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="New clients" value={data.newClients} hint="Added to this branch" />
        <Tile label="Returning clients" value={data.returningClients} hint="Billed before this period too" />
        <Tile label="Clients billed" value={data.visitingClients} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader title="New clients by source" />
          <ReportTable
            columns={[{ key: 'source', header: 'Source', render: (r) => sourceLabel(r.source) }, { key: 'count', header: 'Clients', numeric: true }]}
            rows={data.bySource}
            totals={{ count: data.newClients }}
            rowKey={(r) => r.source ?? 'none'}
          />
        </Card>
        <Card>
          <CardHeader title="Top clients" description="By amount billed in this period." />
          <ReportTable
            columns={[
              {
                key: 'client',
                header: 'Client',
                render: (r) => (
                  <>
                    <span className="block font-medium text-slate-900">{r.client.name}</span>
                    <span className="block text-xs text-slate-500">{r.client.phone}</span>
                  </>
                ),
              },
              { key: 'bills', header: 'Bills', numeric: true },
              money('spent', 'Spent', (r) => r.spentPaise),
            ]}
            rows={data.topClients}
            rowKey={(r) => r.client.id}
          />
        </Card>
      </div>
    </>
  );
}

function Enquiries({ data }) {
  const breakdown = (labels, counts) =>
    Object.entries(labels).map(([key, text]) => (
      <li key={key} className="flex justify-between gap-3">
        <span className="text-slate-500">{text}</span>
        <span className="font-medium text-slate-900 tabular-nums">{counts[key] ?? 0}</span>
      </li>
    ));
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Tile label="Enquiries" value={data.total} />
        <Tile label="Converted" value={data.byStatus.CONVERTED} />
        <Tile label="Conversion rate" value={`${data.conversionRate}%`} />
      </div>
      <div className="grid gap-6 xl:grid-cols-[20rem_1fr]">
        <Card className="h-fit">
          <CardHeader title="By status and type" />
          <ul className="space-y-2 px-5 py-4 text-sm">{breakdown(ENQUIRY_STATUS_LABELS, data.byStatus)}</ul>
          <ul className="space-y-2 border-t border-slate-100 px-5 py-4 text-sm">{breakdown(ENQUIRY_TYPE_LABELS, data.byType)}</ul>
        </Card>
        <Card>
          <CardHeader title="By source" />
          <ReportTable
            columns={[
              { key: 'source', header: 'Source', render: (r) => sourceLabel(r.source) },
              { key: 'total', header: 'Enquiries', numeric: true },
              { key: 'converted', header: 'Converted', numeric: true },
              { key: 'conversionRate', header: 'Conversion', numeric: true, value: (r) => `${r.conversionRate}%` },
            ]}
            rows={data.bySource}
            totals={{ total: data.total, converted: data.byStatus.CONVERTED, conversionRate: data.conversionRate }}
            rowKey={(r) => r.source}
          />
        </Card>
      </div>
    </>
  );
}

function Profit({ data }) {
  const lines = [
    { label: 'Net sales (incl. tax)', amount: data.netSalesPaise },
    { label: 'Less: tax collected', amount: -data.taxPaise },
    { label: 'Sales excl. tax', amount: data.salesExTaxPaise, strong: true },
    ...data.expensesByCategory.map((e) => ({ label: `Expense · ${e.category}`, amount: -e.amountPaise })),
    { label: 'Salaries, incentives & advances', amount: -data.salariesPaise },
    { label: 'Product purchases', amount: -data.productPurchasesPaise },
  ];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Tile label="Sales excl. tax" value={formatINR(data.salesExTaxPaise)} />
        <Tile label="Expenses" value={formatINR(data.expensesPaise)} />
        <Tile label="Salaries" value={formatINR(data.salariesPaise)} />
        <Tile label="Estimated profit" value={formatINR(data.estimatedProfitPaise)} />
      </div>
      <Card>
        <CardHeader title="Profit & loss" description="An estimate: product purchases are counted when bought, not when used." />
        <ReportTable
          columns={[
            { key: 'label', header: 'Item', render: (r) => <span className={r.strong ? 'font-semibold text-slate-900' : undefined}>{r.label}</span> },
            { key: 'amount', header: 'Amount', money: true, render: (r) => <span className={r.amount < 0 ? 'text-rose-600' : undefined}>{formatINR(r.amount)}</span> },
          ]}
          rows={lines}
          totals={{ totalLabel: 'Estimated profit', amount: data.estimatedProfitPaise }}
          rowKey={(r) => r.label}
        />
      </Card>
    </>
  );
}

export const REPORT_VIEWS = {
  'daily-summary': DailySummary,
  'sales-by-item': SalesByItem,
  staff: Staff,
  collections: Collections,
  dues: Dues,
  clients: Clients,
  enquiries: Enquiries,
  profit: Profit,
};
