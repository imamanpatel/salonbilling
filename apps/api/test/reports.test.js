import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { businessDate, datesInRange, instantRange, zonedMidnight } from '../src/services/reports.js';
import { login, resetDatabase, seedBase } from './helpers.js';

const TZ = 'Asia/Kolkata';
const ist = (iso, time) => new Date(`${iso}T${time}+05:30`);
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** supertest parser that keeps binary bodies (xlsx) as a Buffer. */
const binary = (res, callback) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => callback(null, Buffer.concat(chunks)));
};

async function readSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook.worksheets[0];
}

describe('business-date helpers', () => {
  it('converts Asia/Kolkata midnight to 18:30 UTC the previous day', () => {
    expect(zonedMidnight('2026-10-31', TZ).toISOString()).toBe('2026-10-30T18:30:00.000Z');
    expect(zonedMidnight('2026-01-01', TZ).toISOString()).toBe('2025-12-31T18:30:00.000Z');
  });

  it('builds an inclusive date range as a half-open instant range', () => {
    const range = instantRange('2026-03-10', '2026-03-11', TZ);
    expect(range.gte.toISOString()).toBe('2026-03-09T18:30:00.000Z');
    expect(range.lt.toISOString()).toBe('2026-03-11T18:30:00.000Z');
  });

  it('handles zones with daylight saving', () => {
    expect(zonedMidnight('2026-03-08', 'America/New_York').toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(zonedMidnight('2026-03-09', 'America/New_York').toISOString()).toBe('2026-03-09T04:00:00.000Z');
    expect(zonedMidnight('2026-03-10', 'UTC').toISOString()).toBe('2026-03-10T00:00:00.000Z');
  });

  it('maps instants to business dates', () => {
    expect(businessDate(new Date('2026-03-10T18:29:59Z'), TZ)).toBe('2026-03-10');
    expect(businessDate(new Date('2026-03-10T18:30:00Z'), TZ)).toBe('2026-03-11');
    expect(datesInRange('2026-02-27', '2026-03-02')).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('reports & dashboard', () => {
  let app;
  let prisma;
  let fx;
  let admin;
  let desk;
  let boss;
  const today = istToday();

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    await seedReportData();
    admin = await login(app, 'admin');
    desk = await login(app, 'desk');
    boss = await login(app, 'boss');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const get = (agent, path, branchId = fx.a1) => agent.get(`/api${path}`).set(BRANCH_HEADER, branchId);
  const range = 'from=2026-03-10&to=2026-03-11';

  async function seedReportData() {
    const { a1, a2, orgA } = fx;
    const createdById = fx.users.admin;

    const client = (name, phone, createdAt, extra = {}) =>
      prisma.client.create({
        data: { organizationId: orgA, homeBranchId: a1, name, phone, gender: 'FEMALE', referralCode: `REF${phone}`, createdAt, ...extra },
      });
    await prisma.client.update({ where: { id: fx.client }, data: { createdAt: new Date('2025-01-01T06:00:00Z') } });
    const c1 = await client('Asha', '9300000001', ist('2026-03-10', '10:00'), { source: 'INSTAGRAM' });
    const c2 = await client('Bina', '9300000002', ist('2026-03-11', '00:10'), { source: 'INSTAGRAM' });
    const c3 = await client('Chitra', '9300000003', ist('2026-03-10', '23:59'), { source: 'WALK_IN' });
    const c4 = await client('Old Client', '9300000004', new Date('2025-12-01T06:00:00Z'));
    await client('Too late', '9300000006', ist('2026-03-12', '00:00'), { source: 'GOOGLE' });
    await client('Too early', '9300000007', ist('2026-03-09', '23:59'), { source: 'GOOGLE' });
    await client('Other branch', '9300000008', ist('2026-03-10', '12:00'), { homeBranchId: a2, source: 'GOOGLE' });
    await client('New today', '9300000009', new Date());
    await client('New yesterday', '9300000010', new Date(zonedMidnight(today, TZ).getTime() - 60_000));
    fx.clients = { c1: c1.id, c2: c2.id, c3: c3.id, c4: c4.id };

    const product = (name, extra = {}) =>
      prisma.product.create({ data: { branchId: a1, name, mrpPaise: 30000, salePricePaise: 30000, lowStockAt: 5, ...extra } });
    const shampoo = await product('Shampoo');
    const conditioner = await product('Conditioner');
    await product('Serum');
    await product('Retired', { isActive: false });
    await prisma.product.create({ data: { branchId: a2, name: 'A2 product', mrpPaise: 100, salePricePaise: 100 } });
    await prisma.stockMovement.createMany({
      data: [
        { branchId: a1, productId: shampoo.id, qtyChange: 10, reason: 'OPENING' },
        { branchId: a1, productId: shampoo.id, qtyChange: -3, reason: 'SALE' },
        { branchId: a1, productId: conditioner.id, qtyChange: 5, reason: 'OPENING' },
      ],
    });
    const glow = await prisma.package.create({ data: { branchId: a1, name: 'Glow pack', pricePaise: 100000, validityDays: 90 } });
    const gold = await prisma.membershipPlan.create({ data: { branchId: a1, name: 'Gold', pricePaise: 200000, durationDays: 365 } });

    const line = ({ kind = 'SERVICE', name, qty = 1, unit, discount = 0, tax = 0, commission = 0, ...refs }) => ({
      kind, name, qty, unitPricePaise: unit, discountPaise: discount, taxPaise: tax, totalPaise: qty * unit - discount + tax, commissionPaise: commission, ...refs,
    });
    const haircut = (extra = {}) => line({ name: 'Haircut', serviceId: fx.haircut, unit: 50000, ...extra });
    const shampooLine = (extra = {}) => line({ kind: 'PRODUCT', name: 'Shampoo', productId: shampoo.id, unit: 30000, ...extra });
    const bill = ({ branchId = a1, number, clientId, at, status = 'PAID', items, paid, due = 0 }) => {
      const total = items.reduce((s, i) => s + i.totalPaise, 0);
      return prisma.bill.create({
        data: {
          branchId, number, clientId, billedAt: at, status, createdById,
          subtotalPaise: items.reduce((s, i) => s + i.qty * i.unitPricePaise, 0),
          discountPaise: items.reduce((s, i) => s + i.discountPaise, 0),
          taxPaise: items.reduce((s, i) => s + i.taxPaise, 0),
          totalPaise: total, paidPaise: paid ?? total - due, duePaise: due,
          items: { create: items },
        },
      });
    };
    const pay = (kind, method, amountPaise, receivedAt, extra = {}) =>
      prisma.payment.create({ data: { branchId: a1, kind, method, amountPaise, receivedAt, ...extra } });

    // ── Report period: 10–11 Mar 2026 (IST) ──
    const b1 = await bill({
      number: 'A1-0001', clientId: c1.id, at: ist('2026-03-10', '11:00'),
      items: [
        haircut({ discount: 5000, tax: 8100, staffId: fx.stylist, commission: 4500 }),
        shampooLine({ qty: 2, tax: 10800, staffId: fx.stylist2, commission: 3000 }),
      ],
    });
    await pay('BILL', 'CASH', 100000, ist('2026-03-10', '11:05:00'), { billId: b1.id, clientId: c1.id });
    await pay('BILL', 'WALLET', 23900, ist('2026-03-10', '11:05:30'), { billId: b1.id, clientId: c1.id });
    await pay('WALLET_TOPUP', 'UPI', 100000, ist('2026-03-10', '15:00'), { clientId: c1.id });

    // Billed one minute before business midnight: belongs to 10 Mar.
    const b2 = await bill({
      number: 'A1-0002', clientId: c3.id, at: ist('2026-03-10', '23:59'), status: 'PARTIAL', paid: 235000, due: 60000,
      items: [line({ name: 'Hair colour', serviceId: fx.colour, unit: 250000, tax: 45000, staffId: fx.stylist, commission: 25000 })],
    });
    await pay('ADVANCE', 'UPI', 50000, ist('2026-03-09', '15:00'), { billId: b2.id, clientId: c3.id });
    await pay('BILL', 'CARD', 145000, ist('2026-03-10', '23:59'), { billId: b2.id, clientId: c3.id });
    await pay('DUE_COLLECTION', 'CASH', 40000, ist('2026-03-11', '10:00'), { billId: b2.id, clientId: c3.id });

    // Billed one minute after business midnight: belongs to 11 Mar.
    const b3 = await bill({
      number: 'A1-0003', clientId: c2.id, at: ist('2026-03-11', '00:01'),
      items: [
        line({ kind: 'PACKAGE', name: 'Glow pack', packageId: glow.id, unit: 100000, discount: 10000, tax: 16200 }),
        line({ kind: 'MEMBERSHIP', name: 'Gold', membershipPlanId: gold.id, unit: 200000 }),
        line({ kind: 'GIFT_CARD', name: 'Gift card', unit: 50000 }),
      ],
    });
    await pay('BILL', 'GIFT_CARD', 56200, ist('2026-03-11', '00:05:00'), { billId: b3.id, clientId: c2.id });
    await pay('BILL', 'BANK_TRANSFER', 300000, ist('2026-03-11', '00:05:30'), { billId: b3.id, clientId: c2.id });

    const b4 = await bill({
      number: 'A1-0004', clientId: c1.id, at: ist('2026-03-11', '12:00'), status: 'VOID', paid: 59000, due: 10000,
      items: [haircut({ tax: 9000, staffId: fx.stylist, commission: 5000 })],
    });
    await pay('BILL', 'CASH', 59000, ist('2026-03-11', '12:00'), { billId: b4.id, clientId: c1.id });
    await pay('ADVANCE', 'OTHER', 10000, ist('2026-03-11', '12:30'), { billId: b4.id, clientId: c1.id });
    await pay('ADVANCE', 'CASH', 20000, ist('2026-03-11', '13:00'), { clientId: c1.id });

    const b5 = await bill({
      number: 'A1-0005', clientId: c4.id, at: ist('2026-03-10', '09:00'), status: 'PARTIAL', paid: 30000, due: 50000,
      items: [line({ kind: 'OPENING_BALANCE', name: 'Opening balance', unit: 80000 })],
    });
    await pay('DUE_COLLECTION', 'UPI', 30000, ist('2026-03-11', '11:00'), { billId: b5.id, clientId: c4.id });

    await bill({ number: 'A1-0006', clientId: c4.id, at: ist('2026-02-15', '12:00'), items: [haircut({ staffId: fx.stylist2 })] });
    const b7 = await bill({ number: 'A1-0007', clientId: fx.client, at: ist('2026-03-11', '18:00'), items: [shampooLine({ tax: 5400, staffId: fx.stylist2, commission: 1500 })] });
    await pay('BILL', 'CASH', 35400, ist('2026-03-11', '18:00'), { billId: b7.id, clientId: fx.client });
    await bill({ number: 'A1-0008', clientId: fx.client, at: ist('2026-01-05', '12:00'), items: [haircut()] });
    await bill({ number: 'A1-0009', clientId: c1.id, at: ist('2026-02-01', '12:00'), status: 'VOID', items: [haircut()] });
    await pay('WALLET_TOPUP', 'CASH', 7000, ist('2026-03-12', '00:00'), { clientId: c1.id });

    // Other branch: must never leak into A1.
    const other = await bill({
      branchId: a2, number: 'A2-0001', clientId: c1.id, at: ist('2026-03-10', '12:00'), status: 'PARTIAL', due: 7777,
      items: [line({ name: 'A2 service', unit: 99999 })],
    });
    await prisma.payment.create({ data: { branchId: a2, billId: other.id, kind: 'BILL', method: 'CASH', amountPaise: 92222, receivedAt: ist('2026-03-10', '12:00') } });

    const enquiry = (createdAt, type, source, status = 'PENDING', branchId = a1) =>
      prisma.enquiry.create({ data: { branchId, name: 'Lead', phone: '9400000000', enquiryFor: 'Facial', type, source, status, createdAt } });
    await enquiry(ist('2026-03-10', '10:00'), 'HOT', 'INSTAGRAM', 'CONVERTED');
    await enquiry(ist('2026-03-10', '23:59'), 'WARM', 'INSTAGRAM');
    await enquiry(ist('2026-03-11', '09:00'), 'COLD', 'WALK_IN', 'CLOSED');
    await enquiry(ist('2026-03-12', '00:00'), 'HOT', 'GOOGLE');
    await enquiry(ist('2026-03-10', '10:00'), 'HOT', 'GOOGLE', 'PENDING', a2);

    const day = (iso) => new Date(`${iso}T00:00:00Z`);
    await prisma.expense.createMany({
      data: [
        { branchId: a1, spentOn: day('2026-03-10'), category: 'Rent', amountPaise: 50000, method: 'BANK_TRANSFER' },
        { branchId: a1, spentOn: day('2026-03-11'), category: 'Electricity', amountPaise: 12000, method: 'UPI' },
        { branchId: a1, spentOn: day('2026-03-11'), category: 'Rent', amountPaise: 10000, method: 'CASH' },
        { branchId: a1, spentOn: day('2026-03-12'), category: 'Rent', amountPaise: 99999, method: 'CASH' },
        { branchId: a2, spentOn: day('2026-03-10'), category: 'Rent', amountPaise: 88888, method: 'CASH' },
      ],
    });
    const salary = (kind, amountPaise, paidOn) => ({ branchId: a1, staffId: fx.stylist, kind, forMonth: '2026-03', amountPaise, method: 'BANK_TRANSFER', paidOn: day(paidOn) });
    await prisma.salaryEntry.createMany({
      data: [
        salary('SALARY', 100000, '2026-03-10'),
        salary('INCENTIVE', 5000, '2026-03-11'),
        salary('BONUS', 3000, '2026-03-11'),
        salary('ADVANCE', 2000, '2026-03-11'),
        salary('DEDUCTION', 1000, '2026-03-11'),
        salary('SALARY', 77777, '2026-03-09'),
      ],
    });
    const vendor = await prisma.vendor.create({ data: { branchId: a1, name: 'Supplier' } });
    await prisma.purchase.createMany({
      data: [
        { branchId: a1, vendorId: vendor.id, purchasedOn: day('2026-03-10'), subtotalPaise: 40000, totalPaise: 40000 },
        { branchId: a1, vendorId: vendor.id, purchasedOn: day('2026-03-13'), subtotalPaise: 9999, totalPaise: 9999 },
      ],
    });

    // ── Dashboard: today and the last 30 days (IST) ──
    const start = zonedMidnight(today, TZ).getTime();
    const at = (minutes) => new Date(start + minutes * 60_000);
    const t1 = await bill({
      number: 'A1-0101', clientId: c1.id, at: at(1), status: 'PARTIAL', due: 19000,
      items: [haircut({ tax: 9000, staffId: fx.stylist })],
    });
    await pay('BILL', 'CASH', 30000, at(1), { billId: t1.id, clientId: c1.id });
    await pay('BILL', 'WALLET', 10000, at(1), { billId: t1.id, clientId: c1.id });
    const t2 = await bill({
      number: 'A1-0102', clientId: c2.id, at: at(2),
      items: [shampooLine({ tax: 5400 }), line({ name: 'Hair colour', serviceId: fx.colour, qty: 2, unit: 100000, tax: 36000 })],
    });
    await pay('BILL', 'UPI', 271400, at(2), { billId: t2.id, clientId: c2.id });
    const t3 = await bill({ number: 'A1-0103', clientId: c3.id, at: at(3), status: 'VOID', items: [haircut()] });
    await pay('BILL', 'CASH', 10000, at(3), { billId: t3.id, clientId: c3.id });
    await bill({
      number: 'A1-0104', clientId: c4.id, at: at(4), status: 'PARTIAL', due: 20000,
      items: [line({ kind: 'OPENING_BALANCE', name: 'Opening balance', unit: 20000 })],
    });
    await pay('WALLET_TOPUP', 'CARD', 5000, at(5), { clientId: c2.id });
    const y1 = await bill({ number: 'A1-0100', clientId: fx.client, at: at(-1), items: [shampooLine({ unit: 20000 })] });
    await pay('BILL', 'CASH', 20000, at(-1), { billId: y1.id, clientId: fx.client });
    await bill({ number: 'A1-0099', clientId: fx.client, at: new Date(zonedMidnight(shiftIso(today, -29), TZ).getTime() + 12 * 3_600_000), items: [shampooLine({ unit: 11100 })] });
    await bill({ number: 'A1-0098', clientId: fx.client, at: new Date(zonedMidnight(shiftIso(today, -30), TZ).getTime() + 12 * 3_600_000), items: [shampooLine({ unit: 22200 })] });

    const appointment = (status, date = today, branchId = a1) =>
      prisma.appointment.create({ data: { branchId, clientId: c1.id, date: day(date), startTime: '10:00', endTime: '11:00', status } });
    for (const status of ['BOOKED', 'BOOKED', 'CHECKED_IN', 'BILLED', 'CANCELLED']) await appointment(status);
    await appointment('BOOKED', shiftIso(today, 1));
    await appointment('BOOKED', today, a2);

    await enquiry(at(1), 'HOT', 'PHONE');
    await enquiry(new Date(), 'WARM', 'WALK_IN');
    await enquiry(at(-1), 'COLD', 'PHONE');
  }

  describe('dashboard', () => {
    it('summarises today for managers', async () => {
      const res = await get(admin, '/dashboard').expect(200);
      const data = res.body.data;
      expect(data.date).toBe(today);
      expect(data.today).toEqual({
        salesPaise: 330400,
        bills: 2,
        collectionsPaise: 306400,
        appointments: { total: 4, byStatus: { REQUESTED: 0, BOOKED: 2, CHECKED_IN: 1, BILLED: 1, CANCELLED: 1, NO_SHOW: 0 } },
        newEnquiries: 2,
        clientVisits: 2,
        newClients: 1,
      });
      expect(data.duesOutstandingPaise).toBe(149000);
      expect(data.lowStockCount).toBe(2);
      expect(data.topServicesThisMonth).toEqual([
        { serviceId: fx.colour, name: 'Hair colour', qty: 2, salesPaise: 236000 },
        { serviceId: fx.haircut, name: 'Haircut', qty: 1, salesPaise: 59000 },
      ]);
    });

    it('returns all 30 days of sales, zeros included', async () => {
      const { last30Days } = (await get(admin, '/dashboard').expect(200)).body.data;
      expect(last30Days).toHaveLength(30);
      expect(last30Days[0]).toEqual({ date: shiftIso(today, -29), salesPaise: 11100, bills: 1 });
      expect(last30Days[28]).toEqual({ date: shiftIso(today, -1), salesPaise: 20000, bills: 1 });
      expect(last30Days[29]).toEqual({ date: today, salesPaise: 330400, bills: 2 });
      expect(last30Days.reduce((s, d) => s + d.salesPaise, 0)).toBe(361500);
      expect(last30Days[10]).toEqual({ date: shiftIso(today, -19), salesPaise: 0, bills: 0 });
    });

    it('hides money from the front desk', async () => {
      const { data } = (await get(desk, '/dashboard').expect(200)).body;
      expect(data.today.salesPaise).toBeNull();
      expect(data.today.collectionsPaise).toBeNull();
      expect(data.last30Days).toBeNull();
      expect(data.topServicesThisMonth).toBeNull();
      expect(data.today.appointments.total).toBe(4);
      expect(data.today.clientVisits).toBe(2);
      expect(data.today.newEnquiries).toBe(2);
    });

    it('is isolated per branch', async () => {
      const { data } = (await get(boss, '/dashboard', fx.a2).expect(200)).body;
      expect(data.today).toMatchObject({ salesPaise: 0, bills: 0, collectionsPaise: 0, newEnquiries: 0, clientVisits: 0 });
      expect(data.today.appointments.total).toBe(1);
      expect(data.duesOutstandingPaise).toBe(7777);
      expect(data.lowStockCount).toBe(1);
    });
  });

  describe('daily summary', () => {
    const emptyKinds = { SERVICE: 0, PRODUCT: 0, PACKAGE: 0, MEMBERSHIP: 0, GIFT_CARD: 0 };
    const emptyMethods = { CASH: 0, CARD: 0, UPI: 0, BANK_TRANSFER: 0, CHEQUE: 0, OTHER: 0 };

    it('splits days at business midnight and excludes void and opening-balance bills', async () => {
      const { data } = (await get(admin, `/reports/daily-summary?${range}`).expect(200)).body;
      expect(data.rows).toEqual([
        {
          date: '2026-03-10', bills: 2, grossPaise: 360000, discountPaise: 5000, taxPaise: 63900, netPaise: 418900,
          byKind: { ...emptyKinds, SERVICE: 348100, PRODUCT: 70800 },
          collections: { ...emptyMethods, CASH: 100000, CARD: 145000, UPI: 100000 },
          collectedPaise: 345000,
          redemptions: { WALLET: 23900, GIFT_CARD: 0 },
          duesCreatedPaise: 100000,
        },
        {
          date: '2026-03-11', bills: 2, grossPaise: 380000, discountPaise: 10000, taxPaise: 21600, netPaise: 391600,
          byKind: { SERVICE: 0, PRODUCT: 35400, PACKAGE: 106200, MEMBERSHIP: 200000, GIFT_CARD: 50000 },
          collections: { ...emptyMethods, CASH: 95400, UPI: 30000, BANK_TRANSFER: 300000, OTHER: 10000 },
          collectedPaise: 435400,
          redemptions: { WALLET: 0, GIFT_CARD: 56200 },
          duesCreatedPaise: 0,
        },
      ]);
      expect(data.totals).toEqual({
        bills: 4, grossPaise: 740000, discountPaise: 15000, taxPaise: 85500, netPaise: 810500,
        byKind: { SERVICE: 348100, PRODUCT: 106200, PACKAGE: 106200, MEMBERSHIP: 200000, GIFT_CARD: 50000 },
        collections: { CASH: 195400, CARD: 145000, UPI: 130000, BANK_TRANSFER: 300000, CHEQUE: 0, OTHER: 10000 },
        collectedPaise: 780400,
        redemptions: { WALLET: 23900, GIFT_CARD: 56200 },
        duesCreatedPaise: 100000,
      });
    });

    it('downloads as Excel with rupee amounts and a bold totals row', async () => {
      const res = await get(admin, `/reports/daily-summary?${range}&format=xlsx`).buffer(true).parse(binary).expect(200);
      expect(res.headers['content-type']).toContain('spreadsheetml');
      expect(res.headers['content-disposition']).toContain('daily-summary-2026-03-10-2026-03-11.xlsx');
      const sheet = await readSheet(res.body);
      expect(sheet.getRow(1).font.bold).toBe(true);
      expect(sheet.getCell('A1').value).toBe('Date');
      expect(sheet.getCell('F1').value).toBe('Net sales');
      expect(sheet.getCell('A2').value).toBe('2026-03-10');
      expect(sheet.getCell('B2').value).toBe(2);
      expect(sheet.getCell('F2').value).toBe(4189);
      expect(sheet.getCell('F2').numFmt).toBe('₹#,##0.00');
      expect(sheet.getCell('R1').value).toBe('Collected');
      expect(sheet.getCell('R2').value).toBe(3450);
      expect(sheet.getCell('A4').value).toBe('Total');
      expect(sheet.getCell('F4').value).toBe(8105);
      expect(sheet.getCell('U4').value).toBe(1000);
      expect(sheet.getRow(4).font.bold).toBe(true);
    });

    it('is isolated per branch', async () => {
      const { data } = (await get(boss, `/reports/daily-summary?${range}`, fx.a2).expect(200)).body;
      expect(data.totals).toMatchObject({ bills: 1, netPaise: 99999, collectedPaise: 92222 });
    });
  });

  describe('sales by item', () => {
    it('groups items and sorts by total', async () => {
      const { data } = (await get(admin, `/reports/sales-by-item?${range}`).expect(200)).body;
      expect(data.rows.map(({ key, refId, ...row }) => row)).toEqual([
        { kind: 'SERVICE', name: 'Hair colour', qty: 1, grossPaise: 250000, discountPaise: 0, taxablePaise: 250000, taxPaise: 45000, totalPaise: 295000 },
        { kind: 'MEMBERSHIP', name: 'Gold', qty: 1, grossPaise: 200000, discountPaise: 0, taxablePaise: 200000, taxPaise: 0, totalPaise: 200000 },
        { kind: 'PACKAGE', name: 'Glow pack', qty: 1, grossPaise: 100000, discountPaise: 10000, taxablePaise: 90000, taxPaise: 16200, totalPaise: 106200 },
        { kind: 'PRODUCT', name: 'Shampoo', qty: 3, grossPaise: 90000, discountPaise: 0, taxablePaise: 90000, taxPaise: 16200, totalPaise: 106200 },
        { kind: 'SERVICE', name: 'Haircut', qty: 1, grossPaise: 50000, discountPaise: 5000, taxablePaise: 45000, taxPaise: 8100, totalPaise: 53100 },
        { kind: 'GIFT_CARD', name: 'Gift card', qty: 1, grossPaise: 50000, discountPaise: 0, taxablePaise: 50000, taxPaise: 0, totalPaise: 50000 },
      ]);
      expect(data.rows[0].refId).toBe(fx.colour);
      expect(data.totals).toEqual({ qty: 8, grossPaise: 740000, discountPaise: 15000, taxablePaise: 725000, taxPaise: 85500, totalPaise: 810500 });
    });

    it('filters by kind and validates it', async () => {
      const { data } = (await get(admin, `/reports/sales-by-item?${range}&kind=PRODUCT`).expect(200)).body;
      expect(data.rows.map((r) => [r.name, r.qty, r.totalPaise])).toEqual([['Shampoo', 3, 106200]]);
      const bad = await get(admin, `/reports/sales-by-item?${range}&kind=OPENING_BALANCE`).expect(400);
      expect(bad.body.error.details.kind).toBeTruthy();
    });
  });

  describe('staff', () => {
    it('reports services, taxable sales, commission and bills per staff member', async () => {
      const { data } = (await get(admin, `/reports/staff?${range}`).expect(200)).body;
      expect(data.rows).toEqual([
        { staffId: fx.stylist, name: 'Stylist One', services: 2, serviceSalesPaise: 295000, productSalesPaise: 0, commissionPaise: 29500, bills: 2 },
        { staffId: fx.stylist2, name: 'Stylist Two', services: 0, serviceSalesPaise: 0, productSalesPaise: 90000, commissionPaise: 4500, bills: 2 },
      ]);
      expect(data.totals).toEqual({ services: 2, serviceSalesPaise: 295000, productSalesPaise: 90000, commissionPaise: 34000, bills: 3 });
    });
  });

  describe('collections', () => {
    it('lists payments with totals per method, excluding refunds of void bills', async () => {
      const { data } = (await get(admin, `/reports/collections?${range}`).expect(200)).body;
      expect(data.rows.map((r) => [r.date, r.billNumber, r.clientName, r.kind, r.method, r.amountPaise])).toEqual([
        ['2026-03-10', 'A1-0001', 'Asha', 'BILL', 'CASH', 100000],
        ['2026-03-10', 'A1-0001', 'Asha', 'BILL', 'WALLET', 23900],
        ['2026-03-10', null, 'Asha', 'WALLET_TOPUP', 'UPI', 100000],
        ['2026-03-10', 'A1-0002', 'Chitra', 'BILL', 'CARD', 145000],
        ['2026-03-11', 'A1-0003', 'Bina', 'BILL', 'GIFT_CARD', 56200],
        ['2026-03-11', 'A1-0003', 'Bina', 'BILL', 'BANK_TRANSFER', 300000],
        ['2026-03-11', 'A1-0002', 'Chitra', 'DUE_COLLECTION', 'CASH', 40000],
        ['2026-03-11', 'A1-0005', 'Old Client', 'DUE_COLLECTION', 'UPI', 30000],
        ['2026-03-11', 'A1-0004', 'Asha', 'ADVANCE', 'OTHER', 10000],
        ['2026-03-11', null, 'Asha', 'ADVANCE', 'CASH', 20000],
        ['2026-03-11', 'A1-0007', 'Test Client', 'BILL', 'CASH', 35400],
      ]);
      expect(data.totals).toEqual({
        count: 11,
        byMethod: { CASH: 195400, CARD: 145000, UPI: 130000, BANK_TRANSFER: 300000, CHEQUE: 0, WALLET: 23900, GIFT_CARD: 56200, OTHER: 10000 },
        collectedPaise: 780400,
        redemptionsPaise: 80100,
        totalPaise: 860500,
      });
    });

    it('filters by method and respects the end-of-day boundary', async () => {
      const cash = (await get(admin, `/reports/collections?${range}&method=CASH`).expect(200)).body.data;
      expect(cash.totals.count).toBe(4);
      expect(cash.totals.collectedPaise).toBe(195400);
      const next = (await get(admin, '/reports/collections?from=2026-03-12&to=2026-03-12').expect(200)).body.data;
      expect(next.rows.map((r) => r.amountPaise)).toEqual([7000]);
    });
  });

  describe('dues', () => {
    it('lists outstanding non-void bills (opening balances included), oldest first', async () => {
      const { data } = (await get(admin, '/reports/dues').expect(200)).body;
      const age = daysBetween('2026-03-10', today);
      expect(data.rows.map((r) => [r.number, r.date, r.clientName, r.totalPaise, r.paidPaise, r.duePaise, r.ageDays])).toEqual([
        ['A1-0002', '2026-03-10', 'Chitra', 295000, 235000, 60000, age],
        ['A1-0005', '2026-03-10', 'Old Client', 80000, 30000, 50000, age],
        ['A1-0101', today, 'Asha', 59000, 40000, 19000, 0],
        ['A1-0104', today, 'Old Client', 20000, 0, 20000, 0],
      ]);
      expect(data.rows[0].clientPhone).toBe('9300000003');
      expect(data.totals).toEqual({ count: 4, totalPaise: 454000, paidPaise: 305000, duePaise: 149000 });
    });

    it('downloads as Excel', async () => {
      const res = await get(admin, '/reports/dues?format=xlsx').buffer(true).parse(binary).expect(200);
      expect(res.headers['content-disposition']).toContain(`dues-${today}.xlsx`);
      const sheet = await readSheet(res.body);
      expect(sheet.getCell('A6').value).toBe('Total');
      expect(sheet.getCell('G6').value).toBe(1490);
    });
  });

  describe('clients', () => {
    it('counts new and returning clients, sources and top spenders', async () => {
      const { data } = (await get(admin, `/reports/clients?${range}`).expect(200)).body;
      expect(data.newClients).toBe(3);
      expect(data.returningClients).toBe(1);
      expect(data.visitingClients).toBe(4);
      expect(data.bySource).toEqual([{ source: 'INSTAGRAM', count: 2 }, { source: 'WALK_IN', count: 1 }]);
      expect(data.topClients.map((t) => [t.client.name, t.bills, t.spentPaise])).toEqual([
        ['Bina', 1, 356200],
        ['Chitra', 1, 295000],
        ['Asha', 1, 123900],
        ['Test Client', 1, 35400],
      ]);
    });
  });

  describe('enquiries', () => {
    it('breaks enquiries down by status, type and source', async () => {
      const { data } = (await get(admin, `/reports/enquiries?${range}`).expect(200)).body;
      expect(data).toMatchObject({
        total: 3,
        byStatus: { PENDING: 1, CONVERTED: 1, CLOSED: 1 },
        byType: { HOT: 1, WARM: 1, COLD: 1 },
        conversionRate: 33.3,
        bySource: [
          { source: 'INSTAGRAM', total: 2, converted: 1, conversionRate: 50 },
          { source: 'WALK_IN', total: 1, converted: 0, conversionRate: 0 },
        ],
      });
    });
  });

  describe('profit', () => {
    it('estimates profit from sales, expenses, salaries and purchases', async () => {
      const { data } = (await get(admin, `/reports/profit?${range}`).expect(200)).body;
      expect(data).toEqual({
        from: '2026-03-10',
        to: '2026-03-11',
        netSalesPaise: 810500,
        taxPaise: 85500,
        salesExTaxPaise: 725000,
        expensesPaise: 72000,
        expensesByCategory: [{ category: 'Rent', amountPaise: 60000 }, { category: 'Electricity', amountPaise: 12000 }],
        salariesPaise: 110000,
        productPurchasesPaise: 40000,
        estimatedProfitPaise: 503000,
      });
    });

    it('downloads as Excel with the estimated profit as the totals row', async () => {
      const res = await get(admin, `/reports/profit?${range}&format=xlsx`).buffer(true).parse(binary).expect(200);
      const sheet = await readSheet(res.body);
      const last = sheet.getRow(sheet.rowCount);
      expect(last.getCell(1).value).toBe('Estimated profit');
      expect(last.getCell(2).value).toBe(5030);
      expect(last.font.bold).toBe(true);
    });
  });

  describe('access and validation', () => {
    it('is for managers only', async () => {
      await get(desk, `/reports/daily-summary?${range}`).expect(403);
      await get(desk, '/reports/dues').expect(403);
      await get(boss, `/reports/staff?${range}`).expect(200);
    });

    it('validates the date range', async () => {
      const missing = await get(admin, '/reports/daily-summary?to=2026-03-10').expect(400);
      expect(missing.body.error.code).toBe('VALIDATION');
      expect(missing.body.error.details).toEqual({ from: 'From date is required' });
      const reversed = await get(admin, '/reports/profit?from=2026-03-11&to=2026-03-10').expect(400);
      expect(reversed.body.error.details).toEqual({ to: 'Must be on or after the from date' });
      const long = await get(admin, '/reports/collections?from=2025-01-01&to=2026-03-10').expect(400);
      expect(long.body.error.details).toEqual({ to: 'Pick a range of at most 366 days' });
    });
  });
});
