import ExcelJS from 'exceljs';
import { ENQUIRY_STATUSES, ENQUIRY_TYPES, PAYMENT_METHODS } from '@salon/shared';
import {
  APPOINTMENT_STATUSES, COLLECTION_METHODS, ITEM_KIND_LABELS, METHOD_LABELS, PAID_SALARY_KINDS, PAYMENT_KIND_LABELS,
  REDEMPTION_METHODS, SALES_KINDS, rangeDays, shiftIsoDate,
} from '@salon/shared/reports';
import { fromIsoDate } from '../lib/dates.js';

// Reports & dashboard numbers. Every function takes a context `{ prisma, branchId, organizationId, timeZone, today }`
// so it can be tested without HTTP. Sums are done in JS over narrow selects: a branch's yearly volume is small.

// ─── Business dates ↔ instants ────────────────────────────────────────────────

const partsFormatters = new Map();
const dateFormatters = new Map();

function zoneOffsetMs(epochMs, timeZone) {
  if (!partsFormatters.has(timeZone)) {
    partsFormatters.set(timeZone, new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }));
  }
  const seconds = Math.floor(epochMs / 1000) * 1000;
  const p = Object.fromEntries(partsFormatters.get(timeZone).formatToParts(new Date(seconds)).map((part) => [part.type, part.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - seconds;
}

/** The instant a business date starts in `timeZone`, e.g. ("2026-10-31", "Asia/Kolkata") -> 2026-10-30T18:30:00Z. */
export function zonedMidnight(iso, timeZone) {
  const wall = Date.parse(`${iso}T00:00:00Z`);
  const first = wall - zoneOffsetMs(wall, timeZone);
  // Re-check the offset at the candidate instant so DST transitions land correctly.
  return new Date(wall - zoneOffsetMs(first, timeZone));
}

/** Prisma filter for timestamp columns: [start of `from`, start of the day after `to`) in `timeZone`. */
export const instantRange = (from, to, timeZone) => ({ gte: zonedMidnight(from, timeZone), lt: zonedMidnight(shiftIsoDate(to, 1), timeZone) });

/** Prisma filter for @db.Date columns. */
export const dateRange = (from, to) => ({ gte: fromIsoDate(from), lte: fromIsoDate(to) });

/** Business date ("YYYY-MM-DD") of an instant in `timeZone`. */
export function businessDate(instant, timeZone) {
  if (!dateFormatters.has(timeZone)) {
    dateFormatters.set(timeZone, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
  }
  return dateFormatters.get(timeZone).format(instant);
}

export const datesInRange = (from, to) => Array.from({ length: rangeDays(from, to) }, (_, i) => shiftIsoDate(from, i));

// ─── Shared filters ───────────────────────────────────────────────────────────

/** Bills that count as sales: not void, and not an imported opening balance. */
const salesBillWhere = (branchId, billedAt) => ({
  branchId,
  status: { not: 'VOID' },
  ...(billedAt && { billedAt }),
  items: { none: { kind: 'OPENING_BALANCE' } },
});

/** Money received: a void bill refunds its payments, except advances (returned to the appointment). */
const receivedPaymentWhere = (branchId, receivedAt) => ({
  branchId,
  receivedAt,
  kind: { in: ['BILL', 'DUE_COLLECTION', 'ADVANCE', 'WALLET_TOPUP'] },
  OR: [{ billId: null }, { kind: 'ADVANCE' }, { bill: { status: { not: 'VOID' } } }],
});

const zeros = (keys) => Object.fromEntries(keys.map((key) => [key, 0]));
const sum = (rows, pick) => rows.reduce((total, row) => total + pick(row), 0);
const isCash = (method) => COLLECTION_METHODS.includes(method);

// ─── Dashboard ────────────────────────────────────────────────────────────────

const LAST_DAYS = 30;
const TOP_SERVICES = 5;

export async function dashboard(ctx) {
  const { prisma, branchId, organizationId, timeZone, today } = ctx;
  const todayRange = instantRange(today, today, timeZone);
  const windowStart = shiftIsoDate(today, 1 - LAST_DAYS);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [recentBills, payments, appointments, newEnquiries, newClients, dues, products, stock, serviceItems] = await Promise.all([
    prisma.bill.findMany({
      where: salesBillWhere(branchId, instantRange(windowStart, today, timeZone)),
      select: { billedAt: true, totalPaise: true, clientId: true },
    }),
    prisma.payment.findMany({ where: receivedPaymentWhere(branchId, todayRange), select: { method: true, amountPaise: true } }),
    prisma.appointment.groupBy({ by: ['status'], where: { branchId, date: fromIsoDate(today) }, _count: { _all: true } }),
    prisma.enquiry.count({ where: { branchId, createdAt: todayRange } }),
    prisma.client.count({ where: { organizationId, homeBranchId: branchId, createdAt: todayRange } }),
    prisma.bill.aggregate({ where: { branchId, status: { not: 'VOID' } }, _sum: { duePaise: true } }),
    prisma.product.findMany({ where: { branchId, isActive: true }, select: { id: true, lowStockAt: true } }),
    prisma.stockMovement.groupBy({ by: ['productId'], where: { branchId }, _sum: { qtyChange: true } }),
    prisma.billItem.findMany({
      where: { kind: 'SERVICE', serviceId: { not: null }, bill: salesBillWhere(branchId, instantRange(monthStart, today, timeZone)) },
      select: { serviceId: true, name: true, qty: true, totalPaise: true },
    }),
  ]);

  const byDate = new Map(datesInRange(windowStart, today).map((date) => [date, { date, salesPaise: 0, bills: 0 }]));
  const visitors = new Set();
  for (const bill of recentBills) {
    const date = businessDate(bill.billedAt, timeZone);
    const day = byDate.get(date);
    if (!day) continue;
    day.salesPaise += bill.totalPaise;
    day.bills += 1;
    if (date === today) visitors.add(bill.clientId);
  }

  const byStatus = zeros(APPOINTMENT_STATUSES);
  for (const row of appointments) byStatus[row.status] = row._count._all;

  const onHand = new Map(stock.map((row) => [row.productId, row._sum.qtyChange ?? 0]));
  const lowStockCount = products.filter((p) => (onHand.get(p.id) ?? 0) <= p.lowStockAt).length;

  const services = new Map();
  for (const item of serviceItems) {
    const row = services.get(item.serviceId) ?? { serviceId: item.serviceId, name: item.name, qty: 0, salesPaise: 0 };
    row.qty += item.qty;
    row.salesPaise += item.totalPaise;
    services.set(item.serviceId, row);
  }
  const top = [...services.values()].sort((a, b) => b.salesPaise - a.salesPaise || b.qty - a.qty).slice(0, TOP_SERVICES);
  const names = await prisma.service.findMany({ where: { id: { in: top.map((s) => s.serviceId) } }, select: { id: true, name: true } });
  for (const service of names) top.find((s) => s.serviceId === service.id).name = service.name;

  const todayRow = byDate.get(today);
  return {
    date: today,
    today: {
      salesPaise: todayRow.salesPaise,
      bills: todayRow.bills,
      collectionsPaise: sum(payments.filter((p) => isCash(p.method)), (p) => p.amountPaise),
      appointments: { total: sum(appointments.filter((a) => a.status !== 'CANCELLED'), (a) => a._count._all), byStatus },
      newEnquiries,
      clientVisits: visitors.size,
      newClients,
    },
    duesOutstandingPaise: dues._sum.duePaise ?? 0,
    lowStockCount,
    last30Days: [...byDate.values()],
    topServicesThisMonth: top,
  };
}

// ─── Reports ──────────────────────────────────────────────────────────────────

function emptySummary() {
  return {
    bills: 0, grossPaise: 0, discountPaise: 0, taxPaise: 0, netPaise: 0,
    byKind: zeros(SALES_KINDS),
    collections: zeros(COLLECTION_METHODS),
    collectedPaise: 0,
    redemptions: zeros(REDEMPTION_METHODS),
    duesCreatedPaise: 0,
  };
}

function addBill(row, bill) {
  row.bills += 1;
  row.grossPaise += bill.subtotalPaise;
  row.discountPaise += bill.discountPaise;
  row.taxPaise += bill.taxPaise;
  row.netPaise += bill.totalPaise;
  for (const item of bill.items) if (item.kind in row.byKind) row.byKind[item.kind] += item.totalPaise;
  // Dues created = what was left unpaid at billing (later due collections don't reduce it).
  row.duesCreatedPaise += Math.max(0, bill.totalPaise - sum(bill.payments, (p) => p.amountPaise));
}

function addPayment(row, payment) {
  if (isCash(payment.method)) {
    row.collections[payment.method] += payment.amountPaise;
    row.collectedPaise += payment.amountPaise;
  } else row.redemptions[payment.method] += payment.amountPaise;
}

export async function dailySummary({ prisma, branchId, timeZone }, { from, to }) {
  const [bills, payments] = await Promise.all([
    prisma.bill.findMany({
      where: salesBillWhere(branchId, instantRange(from, to, timeZone)),
      select: {
        billedAt: true, subtotalPaise: true, discountPaise: true, taxPaise: true, totalPaise: true,
        items: { select: { kind: true, totalPaise: true } },
        payments: { where: { kind: { in: ['BILL', 'ADVANCE'] } }, select: { amountPaise: true } },
      },
    }),
    prisma.payment.findMany({ where: receivedPaymentWhere(branchId, instantRange(from, to, timeZone)), select: { receivedAt: true, method: true, amountPaise: true } }),
  ]);

  const rows = new Map(datesInRange(from, to).map((date) => [date, { date, ...emptySummary() }]));
  const totals = emptySummary();
  for (const bill of bills) {
    addBill(rows.get(businessDate(bill.billedAt, timeZone)), bill);
    addBill(totals, bill);
  }
  for (const payment of payments) {
    addPayment(rows.get(businessDate(payment.receivedAt, timeZone)), payment);
    addPayment(totals, payment);
  }
  return { from, to, rows: [...rows.values()], totals };
}

const ITEM_REF = { SERVICE: 'serviceId', PRODUCT: 'productId', PACKAGE: 'packageId', MEMBERSHIP: 'membershipPlanId', GIFT_CARD: null };

export async function salesByItem({ prisma, branchId, timeZone }, { from, to, kind }) {
  const items = await prisma.billItem.findMany({
    where: { kind: kind ?? { in: SALES_KINDS }, bill: salesBillWhere(branchId, instantRange(from, to, timeZone)) },
    select: {
      kind: true, name: true, serviceId: true, productId: true, packageId: true, membershipPlanId: true,
      qty: true, unitPricePaise: true, discountPaise: true, taxPaise: true, totalPaise: true,
    },
  });

  const groups = new Map();
  for (const item of items) {
    const refId = ITEM_REF[item.kind] ? item[ITEM_REF[item.kind]] : null;
    const key = `${item.kind}|${refId ?? ''}|${item.name}`;
    const row = groups.get(key) ?? { key, kind: item.kind, refId, name: item.name, qty: 0, grossPaise: 0, discountPaise: 0, taxablePaise: 0, taxPaise: 0, totalPaise: 0 };
    row.qty += item.qty;
    row.grossPaise += item.qty * item.unitPricePaise;
    row.discountPaise += item.discountPaise;
    row.taxablePaise += item.totalPaise - item.taxPaise;
    row.taxPaise += item.taxPaise;
    row.totalPaise += item.totalPaise;
    groups.set(key, row);
  }
  const rows = [...groups.values()].sort((a, b) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name));
  const totals = Object.fromEntries(['qty', 'grossPaise', 'discountPaise', 'taxablePaise', 'taxPaise', 'totalPaise'].map((k) => [k, sum(rows, (r) => r[k])]));
  return { from, to, kind: kind ?? null, rows, totals };
}

export async function staffReport({ prisma, branchId, timeZone }, { from, to }) {
  const items = await prisma.billItem.findMany({
    where: { staffId: { not: null }, kind: { in: SALES_KINDS }, bill: salesBillWhere(branchId, instantRange(from, to, timeZone)) },
    select: { billId: true, staffId: true, kind: true, qty: true, taxPaise: true, totalPaise: true, commissionPaise: true },
  });
  const staffIds = [...new Set(items.map((i) => i.staffId))];
  const staff = await prisma.staff.findMany({
    where: { branchId, OR: [{ isActive: true, kind: 'SERVICE_PROVIDER' }, { id: { in: staffIds } }] },
    select: { id: true, name: true },
  });

  const rows = new Map(staff.map((s) => [s.id, { staffId: s.id, name: s.name, services: 0, serviceSalesPaise: 0, productSalesPaise: 0, commissionPaise: 0, bills: new Set() }]));
  for (const item of items) {
    const row = rows.get(item.staffId);
    if (!row) continue;
    const taxable = item.totalPaise - item.taxPaise;
    if (item.kind === 'SERVICE') {
      row.services += item.qty;
      row.serviceSalesPaise += taxable;
    } else if (item.kind === 'PRODUCT') row.productSalesPaise += taxable;
    row.commissionPaise += item.commissionPaise;
    row.bills.add(item.billId);
  }
  const list = [...rows.values()]
    .map((row) => ({ ...row, bills: row.bills.size }))
    .sort((a, b) => b.serviceSalesPaise + b.productSalesPaise - (a.serviceSalesPaise + a.productSalesPaise) || a.name.localeCompare(b.name));
  const totals = Object.fromEntries(['services', 'serviceSalesPaise', 'productSalesPaise', 'commissionPaise'].map((k) => [k, sum(list, (r) => r[k])]));
  totals.bills = new Set(items.map((i) => i.billId)).size;
  return { from, to, rows: list, totals };
}

export async function collectionsReport({ prisma, branchId, timeZone }, { from, to, method }) {
  const payments = await prisma.payment.findMany({
    where: { ...receivedPaymentWhere(branchId, instantRange(from, to, timeZone)), ...(method && { method }) },
    select: {
      id: true, receivedAt: true, kind: true, method: true, amountPaise: true, reference: true, clientId: true,
      bill: { select: { number: true, client: { select: { name: true } } } },
    },
    orderBy: [{ receivedAt: 'asc' }, { id: 'asc' }],
  });
  const missing = [...new Set(payments.filter((p) => !p.bill && p.clientId).map((p) => p.clientId))];
  const clients = new Map((await prisma.client.findMany({ where: { id: { in: missing } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));

  const rows = payments.map((p) => ({
    id: p.id,
    receivedAt: p.receivedAt.toISOString(),
    date: businessDate(p.receivedAt, timeZone),
    billNumber: p.bill?.number ?? null,
    clientName: p.bill?.client.name ?? clients.get(p.clientId) ?? null,
    kind: p.kind,
    method: p.method,
    amountPaise: p.amountPaise,
    reference: p.reference,
  }));
  const byMethod = zeros(PAYMENT_METHODS);
  for (const row of rows) byMethod[row.method] += row.amountPaise;
  const collectedPaise = sum(COLLECTION_METHODS, (m) => byMethod[m]);
  const redemptionsPaise = sum(REDEMPTION_METHODS, (m) => byMethod[m]);
  return {
    from, to, method: method ?? null, rows,
    totals: { count: rows.length, byMethod, collectedPaise, redemptionsPaise, totalPaise: collectedPaise + redemptionsPaise },
  };
}

export async function duesReport({ prisma, branchId, timeZone, today }) {
  const bills = await prisma.bill.findMany({
    where: { branchId, status: { not: 'VOID' }, duePaise: { gt: 0 } },
    select: {
      id: true, number: true, billedAt: true, totalPaise: true, paidPaise: true, duePaise: true,
      client: { select: { id: true, name: true, phone: true } },
    },
  });
  const rows = bills
    .map((bill) => {
      const date = businessDate(bill.billedAt, timeZone);
      return {
        billId: bill.id, number: bill.number, date, clientId: bill.client.id, clientName: bill.client.name, clientPhone: bill.client.phone,
        totalPaise: bill.totalPaise, paidPaise: bill.paidPaise, duePaise: bill.duePaise, ageDays: Math.max(0, rangeDays(date, today) - 1),
      };
    })
    .sort((a, b) => b.ageDays - a.ageDays || a.number.localeCompare(b.number));
  const totals = { count: rows.length, totalPaise: sum(rows, (r) => r.totalPaise), paidPaise: sum(rows, (r) => r.paidPaise), duePaise: sum(rows, (r) => r.duePaise) };
  return { date: today, rows, totals };
}

const TOP_CLIENTS = 20;

export async function clientsReport({ prisma, branchId, organizationId, timeZone }, { from, to }) {
  const range = instantRange(from, to, timeZone);
  const newWhere = { organizationId, homeBranchId: branchId, createdAt: range };
  const [newClients, sources, bills] = await Promise.all([
    prisma.client.count({ where: newWhere }),
    prisma.client.groupBy({ by: ['source'], where: newWhere, _count: { _all: true } }),
    prisma.bill.findMany({ where: salesBillWhere(branchId, range), select: { clientId: true, totalPaise: true } }),
  ]);

  const spend = new Map();
  for (const bill of bills) {
    const row = spend.get(bill.clientId) ?? { clientId: bill.clientId, bills: 0, spentPaise: 0 };
    row.bills += 1;
    row.spentPaise += bill.totalPaise;
    spend.set(bill.clientId, row);
  }
  const visitorIds = [...spend.keys()];
  const earlier = await prisma.bill.findMany({
    where: { branchId, status: { not: 'VOID' }, billedAt: { lt: range.gte }, clientId: { in: visitorIds } },
    distinct: ['clientId'],
    select: { clientId: true },
  });

  const top = [...spend.values()].sort((a, b) => b.spentPaise - a.spentPaise || b.bills - a.bills).slice(0, TOP_CLIENTS);
  const people = new Map(
    (await prisma.client.findMany({ where: { id: { in: top.map((t) => t.clientId) } }, select: { id: true, name: true, phone: true } })).map((c) => [c.id, c]),
  );
  return {
    from,
    to,
    newClients,
    returningClients: earlier.length,
    visitingClients: visitorIds.length,
    bySource: sources.map((s) => ({ source: s.source, count: s._count._all })).sort((a, b) => b.count - a.count),
    topClients: top.map((t) => ({ client: people.get(t.clientId), bills: t.bills, spentPaise: t.spentPaise })),
  };
}

const percentage = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

export async function enquiriesReport({ prisma, branchId, timeZone }, { from, to }) {
  const enquiries = await prisma.enquiry.findMany({
    where: { branchId, createdAt: instantRange(from, to, timeZone) },
    select: { status: true, type: true, source: true },
  });
  const byStatus = zeros(ENQUIRY_STATUSES);
  const byType = zeros(ENQUIRY_TYPES);
  const sources = new Map();
  for (const e of enquiries) {
    byStatus[e.status] += 1;
    byType[e.type] += 1;
    const row = sources.get(e.source) ?? { source: e.source, total: 0, converted: 0 };
    row.total += 1;
    if (e.status === 'CONVERTED') row.converted += 1;
    sources.set(e.source, row);
  }
  return {
    from,
    to,
    total: enquiries.length,
    byStatus,
    byType,
    conversionRate: percentage(byStatus.CONVERTED, enquiries.length),
    /** conversionRate is a percentage with one decimal, e.g. 33.3. */
    bySource: [...sources.values()]
      .map((row) => ({ ...row, conversionRate: percentage(row.converted, row.total) }))
      .sort((a, b) => b.total - a.total || a.source.localeCompare(b.source)),
  };
}

export async function profitReport({ prisma, branchId, timeZone }, { from, to }) {
  const days = dateRange(from, to);
  const [sales, expenses, salaries, purchases] = await Promise.all([
    prisma.bill.aggregate({ where: salesBillWhere(branchId, instantRange(from, to, timeZone)), _sum: { totalPaise: true, taxPaise: true } }),
    prisma.expense.groupBy({ by: ['category'], where: { branchId, spentOn: days }, _sum: { amountPaise: true } }),
    prisma.salaryEntry.aggregate({ where: { branchId, kind: { in: PAID_SALARY_KINDS }, paidOn: days }, _sum: { amountPaise: true } }),
    prisma.purchase.aggregate({ where: { branchId, purchasedOn: days }, _sum: { totalPaise: true } }),
  ]);
  const netSalesPaise = sales._sum.totalPaise ?? 0;
  const taxPaise = sales._sum.taxPaise ?? 0;
  const salesExTaxPaise = netSalesPaise - taxPaise;
  const expensesByCategory = expenses
    .map((e) => ({ category: e.category, amountPaise: e._sum.amountPaise ?? 0 }))
    .sort((a, b) => b.amountPaise - a.amountPaise || a.category.localeCompare(b.category));
  const expensesPaise = sum(expensesByCategory, (e) => e.amountPaise);
  const salariesPaise = salaries._sum.amountPaise ?? 0;
  const productPurchasesPaise = purchases._sum.totalPaise ?? 0;
  return {
    from, to, netSalesPaise, taxPaise, salesExTaxPaise, expensesPaise, expensesByCategory, salariesPaise, productPurchasesPaise,
    estimatedProfitPaise: salesExTaxPaise - expensesPaise - salariesPaise - productPurchasesPaise,
  };
}

// ─── Excel ────────────────────────────────────────────────────────────────────

export const MONEY_FORMAT = '₹#,##0.00';

/**
 * One worksheet built from sections: `{ heading?, columns: [{ header, value(row), money?, format? }], rows, totals? }`.
 * Money columns take paise and are written as rupees; totals rows are bold.
 */
export async function buildWorkbook(title, sections) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(title);
  const widths = [];
  sections.forEach((section, index) => {
    if (index > 0) sheet.addRow([]);
    if (section.heading) sheet.addRow([section.heading]).font = { bold: true, size: 12 };
    sheet.addRow(section.columns.map((c) => c.header)).font = { bold: true };
    const write = (source, bold) => {
      const row = sheet.addRow(section.columns.map((c) => {
        const value = c.value(source);
        return c.money && typeof value === 'number' ? value / 100 : value ?? null;
      }));
      section.columns.forEach((c, i) => {
        if (c.money || c.format) row.getCell(i + 1).numFmt = c.money ? MONEY_FORMAT : c.format;
      });
      if (bold) row.font = { bold: true };
    };
    section.rows.forEach((row) => write(row, false));
    if (section.totals) write(section.totals, true);
    section.columns.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 10, c.width ?? Math.min(40, c.header.length + 4));
    });
  });
  widths.forEach((width, i) => {
    sheet.getColumn(i + 1).width = width;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

const money = (header, pick) => ({ header, value: pick, money: true, width: 14 });
const text = (header, pick, width) => ({ header, value: pick, width });
const count = (header, pick) => ({ header, value: pick, width: Math.max(8, header.length + 2) });
const SOURCE_LABEL = (source) => (source ? source.replaceAll('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) : 'Not set');

/** Worksheet sections for each report's JSON output. */
export const REPORT_SHEETS = {
  'daily-summary': (data) => [{
    columns: [
      text('Date', (r) => r.date ?? 'Total', 12),
      count('Bills', (r) => r.bills),
      money('Gross', (r) => r.grossPaise),
      money('Discount', (r) => r.discountPaise),
      money('Tax', (r) => r.taxPaise),
      money('Net sales', (r) => r.netPaise),
      ...SALES_KINDS.map((k) => money(ITEM_KIND_LABELS[k], (r) => r.byKind[k])),
      ...COLLECTION_METHODS.map((m) => money(METHOD_LABELS[m], (r) => r.collections[m])),
      money('Collected', (r) => r.collectedPaise),
      ...REDEMPTION_METHODS.map((m) => money(`${METHOD_LABELS[m]} used`, (r) => r.redemptions[m])),
      money('Dues created', (r) => r.duesCreatedPaise),
    ],
    rows: data.rows,
    totals: data.totals,
  }],
  'sales-by-item': (data) => [{
    columns: [
      text('Item', (r) => r.name ?? 'Total', 32),
      text('Type', (r) => (r.kind ? ITEM_KIND_LABELS[r.kind] : ''), 12),
      count('Qty', (r) => r.qty),
      money('Gross', (r) => r.grossPaise),
      money('Discount', (r) => r.discountPaise),
      money('Taxable', (r) => r.taxablePaise),
      money('Tax', (r) => r.taxPaise),
      money('Total', (r) => r.totalPaise),
    ],
    rows: data.rows,
    totals: data.totals,
  }],
  staff: (data) => [{
    columns: [
      text('Staff', (r) => r.name ?? 'Total', 24),
      count('Services', (r) => r.services),
      money('Service sales', (r) => r.serviceSalesPaise),
      money('Product sales', (r) => r.productSalesPaise),
      money('Commission', (r) => r.commissionPaise),
      count('Bills', (r) => r.bills),
    ],
    rows: data.rows,
    totals: data.totals,
  }],
  collections: (data) => [
    {
      columns: [
        text('Received', (r) => r.date ?? 'Total', 12),
        text('Bill', (r) => r.billNumber, 14),
        text('Client', (r) => r.clientName, 24),
        text('Type', (r) => PAYMENT_KIND_LABELS[r.kind] ?? '', 14),
        text('Method', (r) => METHOD_LABELS[r.method] ?? '', 14),
        money('Amount', (r) => r.amountPaise),
        text('Reference', (r) => r.reference, 20),
      ],
      rows: data.rows,
      totals: { amountPaise: data.totals.totalPaise },
    },
    {
      heading: 'By method',
      columns: [text('Method', (r) => r.label, 18), money('Amount', (r) => r.amountPaise)],
      rows: PAYMENT_METHODS.map((m) => ({ label: METHOD_LABELS[m], amountPaise: data.totals.byMethod[m] })),
      totals: { label: 'Collected (excl. wallet & gift cards)', amountPaise: data.totals.collectedPaise },
    },
  ],
  dues: (data) => [{
    columns: [
      text('Bill', (r) => r.number ?? 'Total', 14),
      text('Date', (r) => r.date, 12),
      text('Client', (r) => r.clientName, 24),
      text('Phone', (r) => r.clientPhone, 16),
      money('Total', (r) => r.totalPaise),
      money('Paid', (r) => r.paidPaise),
      money('Due', (r) => r.duePaise),
      count('Age (days)', (r) => r.ageDays),
    ],
    rows: data.rows,
    totals: data.totals,
  }],
  clients: (data) => [
    {
      columns: [text('Clients', (r) => r.label, 24), count('Count', (r) => r.count)],
      rows: [
        { label: 'New clients', count: data.newClients },
        { label: 'Returning clients', count: data.returningClients },
        { label: 'Clients billed', count: data.visitingClients },
      ],
    },
    {
      heading: 'New clients by source',
      columns: [text('Source', (r) => r.label ?? SOURCE_LABEL(r.source), 24), count('Count', (r) => r.count)],
      rows: data.bySource,
      totals: { label: 'Total', count: data.newClients },
    },
    {
      heading: 'Top clients',
      columns: [
        text('Client', (r) => r.client?.name ?? 'Total', 24),
        text('Phone', (r) => r.client?.phone, 16),
        count('Bills', (r) => r.bills),
        money('Spent', (r) => r.spentPaise),
      ],
      rows: data.topClients,
    },
  ],
  enquiries: (data) => [
    {
      columns: [text('Status / type', (r) => r.label, 18), count('Enquiries', (r) => r.count)],
      rows: [
        ...ENQUIRY_STATUSES.map((s) => ({ label: s.charAt(0) + s.slice(1).toLowerCase(), count: data.byStatus[s] })),
        ...ENQUIRY_TYPES.map((t) => ({ label: `${t.charAt(0) + t.slice(1).toLowerCase()} leads`, count: data.byType[t] })),
      ],
      totals: { label: 'Total', count: data.total },
    },
    {
      heading: 'By source',
      columns: [
        text('Source', (r) => r.label ?? SOURCE_LABEL(r.source), 18),
        count('Enquiries', (r) => r.total),
        count('Converted', (r) => r.converted),
        { header: 'Conversion', value: (r) => r.conversionRate / 100, format: '0.0%', width: 12 },
      ],
      rows: data.bySource,
      totals: { label: 'Total', total: data.total, converted: data.byStatus.CONVERTED, conversionRate: data.conversionRate },
    },
  ],
  profit: (data) => [{
    columns: [text('Profit & loss', (r) => r.label, 36), money('Amount', (r) => r.amountPaise)],
    rows: [
      { label: 'Net sales (incl. tax)', amountPaise: data.netSalesPaise },
      { label: 'Less: tax collected', amountPaise: -data.taxPaise },
      { label: 'Sales excl. tax', amountPaise: data.salesExTaxPaise },
      ...data.expensesByCategory.map((e) => ({ label: `Expense: ${e.category}`, amountPaise: -e.amountPaise })),
      { label: 'Salaries, incentives & advances', amountPaise: -data.salariesPaise },
      { label: 'Product purchases', amountPaise: -data.productPurchasesPaise },
    ],
    totals: { label: 'Estimated profit', amountPaise: data.estimatedProfitPaise },
  }],
};

export const REPORT_TITLES = {
  'daily-summary': 'Daily summary', 'sales-by-item': 'Sales by item', staff: 'Staff', collections: 'Collections',
  dues: 'Dues', clients: 'Clients', enquiries: 'Enquiries', profit: 'Profit',
};
