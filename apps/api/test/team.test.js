import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { login, resetDatabase, seedBase } from './helpers.js';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('Team & expenses (M6)', () => {
  let app;
  let prisma;
  let fx;
  let billSeq = 0;
  const today = istToday();
  const month = today.slice(0, 7);
  const monthStart = `${month}-01`;
  // First instant of this month in Asia/Kolkata (UTC+05:30).
  const monthStartInstant = new Date(Date.parse(`${monthStart}T00:00:00+05:30`));

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    await prisma.staff.update({ where: { id: fx.stylist }, data: { monthlySalaryPaise: 2_000_000 } });
    await prisma.staff.create({
      data: { branchId: fx.a1, kind: 'STAFF', name: 'Desk Helper', phone: '9100000003', gender: 'MALE', joinedOn: new Date('2026-01-01'), monthlySalaryPaise: 1_200_000 },
    });

    // Commission data: a paid bill this month, a void bill (ignored), and a bill one minute before the month began.
    await seedBill({ status: 'PAID', billedAt: new Date(), lines: [
      { kind: 'SERVICE', staffId: fx.stylist, name: 'Haircut', qty: 1, totalPaise: 59_000, taxPaise: 9_000, commissionPaise: 5_000 },
      { kind: 'PRODUCT', staffId: fx.stylist, name: 'Shampoo', qty: 2, totalPaise: 23_600, taxPaise: 3_600, commissionPaise: 1_000 },
      { kind: 'SERVICE', staffId: fx.stylist2, name: 'Hair colour', qty: 1, totalPaise: 118_000, taxPaise: 18_000, commissionPaise: 10_000 },
    ] });
    await seedBill({ status: 'VOID', billedAt: new Date(), lines: [
      { kind: 'SERVICE', staffId: fx.stylist, name: 'Haircut', qty: 1, totalPaise: 59_000, taxPaise: 9_000, commissionPaise: 99_999 },
    ] });
    await seedBill({ status: 'PARTIAL', billedAt: new Date(monthStartInstant.getTime() - 60_000), lines: [
      { kind: 'SERVICE', staffId: fx.stylist, name: 'Haircut', qty: 1, totalPaise: 59_000, taxPaise: 9_000, commissionPaise: 7_000 },
    ] });
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function seedBill({ status, billedAt, lines, branchId = fx.a1 }) {
    billSeq += 1;
    const total = lines.reduce((sum, l) => sum + l.totalPaise, 0);
    const tax = lines.reduce((sum, l) => sum + l.taxPaise, 0);
    return prisma.bill.create({
      data: {
        branchId, number: `T-${String(billSeq).padStart(6, '0')}`, clientId: fx.client, billedAt, status,
        subtotalPaise: total - tax, discountPaise: 0, taxPaise: tax, totalPaise: total, paidPaise: total, duePaise: 0,
        createdById: fx.users.admin,
        items: { create: lines.map((l) => ({ ...l, unitPricePaise: Math.round((l.totalPaise - l.taxPaise) / l.qty), discountPaise: 0 })) },
      },
    });
  }

  const as = async (username, branchId = fx.a1) => {
    const agent = await login(app, username);
    const wrap = (method) => (path) => agent[method](`/api${path}`).set(BRANCH_HEADER, branchId);
    return { get: wrap('get'), post: wrap('post'), put: wrap('put'), delete: wrap('delete') };
  };

  describe('attendance', () => {
    it('lists every active staff member with their record for the day', async () => {
      const desk = await as('desk');
      const res = await desk.get(`/attendance?date=${today}`).expect(200);
      expect(res.body.data.map((r) => r.staff.name)).toEqual(['Stylist One', 'Stylist Two', 'Desk Helper']);
      expect(res.body.data.every((r) => r.record === null)).toBe(true);
      await desk.get('/attendance?date=31-10-2026').expect(400);
    });

    it('upserts a day record and validates times', async () => {
      const desk = await as('desk');
      const day = shiftIso(today, -1);
      const first = await desk.put('/attendance').send({ staffId: fx.stylist, date: day, status: 'HALF_DAY', checkIn: '10:00', checkOut: '14:00' }).expect(200);
      const again = await desk.put('/attendance').send({ staffId: fx.stylist, date: day, status: 'PRESENT', checkIn: '10:00', checkOut: '19:30', note: 'Stayed late' }).expect(200);
      expect(again.body.data).toMatchObject({ id: first.body.data.id, date: day, status: 'PRESENT', checkOut: '19:30', note: 'Stayed late' });
      expect(await prisma.attendance.count({ where: { staffId: fx.stylist } })).toBe(1);

      const bad = await desk.put('/attendance').send({ staffId: fx.stylist, date: day, status: 'PRESENT', checkIn: '10:00', checkOut: '09:00' });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details).toEqual({ checkOut: 'Cannot be before check-in' });

      const listed = await desk.get(`/attendance?date=${day}`).expect(200);
      expect(listed.body.data.find((r) => r.staff.id === fx.stylist).record).toMatchObject({ status: 'PRESENT', checkIn: '10:00' });
    });

    it('checks staff in and out at the current business time', async () => {
      const desk = await as('desk');
      const early = await desk.post('/attendance/check-out').send({ staffId: fx.stylist2 });
      expect(early.status).toBe(409);
      expect(early.body.error.message).toMatch(/not checked in/);

      const checkIn = await desk.post('/attendance/check-in').send({ staffId: fx.stylist2 }).expect(200);
      expect(checkIn.body.data).toMatchObject({ date: today, status: 'PRESENT', checkOut: null });
      expect(checkIn.body.data.checkIn).toMatch(HHMM);
      await desk.post('/attendance/check-in').send({ staffId: fx.stylist2 }).expect(409);

      const checkOut = await desk.post('/attendance/check-out').send({ staffId: fx.stylist2 }).expect(200);
      expect(checkOut.body.data.checkOut).toMatch(HHMM);
      expect(checkOut.body.data.checkOut >= checkOut.body.data.checkIn).toBe(true);

      await desk.post('/attendance/check-in').send({ staffId: 'not-a-uuid' }).expect(400);
    });

    it('summarises the month per staff member', async () => {
      const desk = await as('desk');
      // Make sure the month has at least one ABSENT and one LEAVE row for the stylist.
      const other = today === monthStart ? shiftIso(today, 1) : monthStart;
      await desk.put('/attendance').send({ staffId: fx.stylist, date: other, status: 'LEAVE' }).expect(200);
      await desk.put('/attendance').send({ staffId: fx.stylist, date: today, status: 'ABSENT' }).expect(200);

      const res = await desk.get(`/attendance/monthly?month=${month}`).expect(200);
      const { days, staff } = res.body.data;
      expect(days[0]).toBe(monthStart);
      expect(days).toContain(today);
      const stylist = staff.find((s) => s.id === fx.stylist);
      expect(stylist.records[today]).toEqual({ status: 'ABSENT', checkIn: null, checkOut: null });
      expect(stylist.summary.absent).toBe(1);
      expect(stylist.summary.leave).toBe(today === monthStart ? 0 : 1);
      const stylist2 = staff.find((s) => s.id === fx.stylist2);
      expect(stylist2.summary).toEqual({ present: 1, halfDay: 0, absent: 0, leave: 0 });
      await desk.get('/attendance/monthly?month=2026-13').expect(400);
    });
  });

  describe('salaries', () => {
    it('keeps the front desk out', async () => {
      const desk = await as('desk');
      await desk.get(`/salaries?month=${month}`).expect(403);
      await desk.post('/salaries').send({}).expect(403);
    });

    it('records and deletes salary entries and computes the payable amount', async () => {
      const admin = await as('admin');
      const entry = (kind, amountPaise) => ({ staffId: fx.stylist, kind, forMonth: month, amountPaise, method: 'CASH', paidOn: today });
      await admin.post('/salaries').send(entry('ADVANCE', 300_000)).expect(201);
      await admin.post('/salaries').send(entry('INCENTIVE', 50_000)).expect(201);
      await admin.post('/salaries').send({ ...entry('SALARY', 1_000_000), method: 'UPI', note: 'Part payment' }).expect(201);
      const mistake = await admin.post('/salaries').send(entry('BONUS', 99_900)).expect(201);
      await admin.delete(`/salaries/${mistake.body.data.id}`).expect(204);
      await admin.delete(`/salaries/${mistake.body.data.id}`).expect(404);

      const invalid = await admin.post('/salaries').send({ ...entry('SALARY', 0), method: 'WALLET', forMonth: '2026-1' });
      expect(invalid.status).toBe(400);
      expect(Object.keys(invalid.body.error.details).sort()).toEqual(['amountPaise', 'forMonth', 'method']);

      const res = await admin.get(`/salaries?month=${month}`).expect(200);
      const row = res.body.data.find((r) => r.staff.id === fx.stylist);
      expect(row).toMatchObject({
        monthlySalaryPaise: 2_000_000,
        commissionPaise: 6_000, // void bill and last month's bill excluded
        paidSalaryPaise: 1_000_000,
        totalsByKind: { SALARY: 1_000_000, ADVANCE: 300_000, INCENTIVE: 50_000, BONUS: 0, DEDUCTION: 0 },
        suggestedPayablePaise: 2_000_000 + 50_000 + 6_000 - 300_000 - 1_000_000,
      });
      expect(row.entries).toHaveLength(3);
      expect(row.entries[0]).toMatchObject({ forMonth: month, paidOn: today });

      const helper = res.body.data.find((r) => r.staff.name === 'Desk Helper');
      expect(helper).toMatchObject({ commissionPaise: 0, suggestedPayablePaise: 1_200_000, entries: [] });
      expect(res.body.data.find((r) => r.staff.id === fx.stylist2).commissionPaise).toBe(10_000);
    });

    it('counts commission by business-time month boundaries', async () => {
      const admin = await as('admin');
      const previous = shiftIso(monthStart, -1).slice(0, 7);
      const res = await admin.get(`/salaries?month=${previous}`).expect(200);
      expect(res.body.data.find((r) => r.staff.id === fx.stylist).commissionPaise).toBe(7_000);
    });
  });

  describe('commissions', () => {
    it('reports sales and commission per staff member', async () => {
      const admin = await as('admin');
      const res = await admin.get(`/commissions?from=${monthStart}&to=${today}`).expect(200);
      const byId = Object.fromEntries(res.body.data.map((r) => [r.staff.id, r]));
      expect(byId[fx.stylist]).toMatchObject({ servicesCount: 1, serviceSalesPaise: 50_000, productSalesPaise: 20_000, commissionPaise: 6_000 });
      expect(byId[fx.stylist2]).toMatchObject({ servicesCount: 1, serviceSalesPaise: 100_000, productSalesPaise: 0, commissionPaise: 10_000 });

      const wide = await admin.get(`/commissions?from=${shiftIso(monthStart, -1)}&to=${today}`).expect(200);
      expect(wide.body.data.find((r) => r.staff.id === fx.stylist).commissionPaise).toBe(13_000);

      await admin.get(`/commissions?from=${today}&to=${shiftIso(today, -1)}`).expect(400);
      const desk = await as('desk');
      await desk.get('/commissions').expect(403);
    });

    it('lists the commission lines of one staff member', async () => {
      const admin = await as('admin');
      const res = await admin.get(`/commissions/${fx.stylist}?from=${monthStart}&to=${today}`).expect(200);
      expect(res.body.data.summary).toEqual({ servicesCount: 1, serviceSalesPaise: 50_000, productSalesPaise: 20_000, commissionPaise: 6_000 });
      expect(res.body.data.lines).toHaveLength(2);
      expect(res.body.data.lines.find((l) => l.kind === 'PRODUCT')).toMatchObject({
        billNumber: 'T-000001', date: today, name: 'Shampoo', qty: 2, taxablePaise: 20_000, commissionPaise: 1_000,
      });
      await admin.get('/commissions/00000000-0000-4000-8000-000000000000').expect(404);
    });
  });

  describe('expenses', () => {
    it('creates, updates, filters, totals and deletes expenses', async () => {
      const admin = await as('admin');
      const base = { spentOn: today, amountPaise: 150_000, method: 'CASH' };
      const rent = await admin.post('/expenses').send({ ...base, category: 'Rent', amountPaise: 2_500_000, method: 'BANK_TRANSFER', paidTo: 'Landlord' }).expect(201);
      const tea = await admin.post('/expenses').send({ ...base, category: 'Tea & snacks', amountPaise: 20_000 }).expect(201);
      await admin.post('/expenses').send({ ...base, category: 'Tea & snacks', amountPaise: 30_000, description: 'Biscuits' }).expect(201);
      await admin.post('/expenses').send({ ...base, category: 'Laundry' }).expect(201);
      await admin.post('/expenses').send({ ...base, spentOn: shiftIso(monthStart, -1), category: 'Rent' }).expect(201);

      const invalid = await admin.post('/expenses').send({ spentOn: 'today', category: '', amountPaise: 0, method: 'WALLET' });
      expect(invalid.status).toBe(400);
      expect(Object.keys(invalid.body.error.details).sort()).toEqual(['amountPaise', 'category', 'method', 'spentOn']);

      const updated = await admin.put(`/expenses/${tea.body.data.id}`).send({ ...base, category: 'Tea & snacks', amountPaise: 25_000 }).expect(200);
      expect(updated.body.data).toMatchObject({ amountPaise: 25_000, spentOn: today });

      const all = await admin.get(`/expenses?from=${monthStart}&to=${today}`).expect(200);
      expect(all.body.data).toMatchObject({ total: 4, page: 1, totalPaise: 2_500_000 + 25_000 + 30_000 + 150_000 });
      expect(all.body.data.totalsByCategory).toEqual([
        { category: 'Rent', amountPaise: 2_500_000, count: 1 },
        { category: 'Laundry', amountPaise: 150_000, count: 1 },
        { category: 'Tea & snacks', amountPaise: 55_000, count: 2 },
      ]);

      const filtered = await admin.get(`/expenses?from=${monthStart}&to=${today}&category=${encodeURIComponent('tea & snacks')}&pageSize=1`).expect(200);
      expect(filtered.body.data).toMatchObject({ total: 2, pageSize: 1, totalPaise: 55_000 });
      expect(filtered.body.data.items).toHaveLength(1);
      expect(filtered.body.data.totalsByCategory).toHaveLength(3);

      await admin.delete(`/expenses/${rent.body.data.id}`).expect(204);
      const after = await admin.get(`/expenses?from=${monthStart}&to=${today}`).expect(200);
      expect(after.body.data.total).toBe(3);

      const desk = await as('desk');
      await desk.get('/expenses').expect(403);
    });

    it('suggests default categories plus the ones in use', async () => {
      const admin = await as('admin');
      const res = await admin.get('/expenses/categories').expect(200);
      expect(res.body.data.slice(0, 2)).toEqual(['Rent', 'Electricity']);
      expect(res.body.data).toContain('Laundry');
      expect(res.body.data.filter((c) => c === 'Tea & snacks')).toHaveLength(1);
    });
  });

  describe('branch isolation', () => {
    it('never exposes another branch’s records', async () => {
      const boss = await as('boss', fx.a2);
      const expenses = await boss.get('/expenses').expect(200);
      expect(expenses.body.data.total).toBe(0);
      const anyExpense = await prisma.expense.findFirst({ where: { branchId: fx.a1 } });
      await boss.delete(`/expenses/${anyExpense.id}`).expect(404);
      await boss.put('/attendance').send({ staffId: fx.stylist, date: today, status: 'PRESENT' }).expect(404);
      await boss.post('/attendance/check-in').send({ staffId: fx.stylist }).expect(404);
      await boss.post('/salaries').send({ staffId: fx.stylist, kind: 'SALARY', forMonth: month, amountPaise: 100, method: 'CASH', paidOn: today }).expect(404);
      const salaryEntry = await prisma.salaryEntry.findFirst({ where: { branchId: fx.a1 } });
      await boss.delete(`/salaries/${salaryEntry.id}`).expect(404);
      expect((await boss.get('/attendance').expect(200)).body.data).toEqual([]);
      expect((await boss.get(`/salaries?month=${month}`).expect(200)).body.data).toEqual([]);
      await boss.get(`/commissions/${fx.stylist}`).expect(404);

      const deskOnA2 = await as('desk', fx.a2);
      await deskOnA2.get('/attendance').expect(403);
    });
  });

  describe('staff transfer', () => {
    it('is blocked while the staff member has upcoming appointments', async () => {
      await prisma.appointment.create({
        data: {
          branchId: fx.a1, clientId: fx.client, date: new Date(`${shiftIso(today, 1)}T00:00:00Z`), startTime: '11:00', endTime: '11:30', status: 'BOOKED',
          items: { create: [{ serviceId: fx.haircut, staffId: fx.stylist2, startTime: '11:00', endTime: '11:30', pricePaise: 50_000 }] },
        },
      });
      // Past and cancelled appointments do not block.
      await prisma.appointment.create({
        data: {
          branchId: fx.a1, clientId: fx.client, date: new Date(`${shiftIso(today, -3)}T00:00:00Z`), startTime: '11:00', endTime: '11:30', status: 'BOOKED',
          items: { create: [{ serviceId: fx.haircut, staffId: fx.stylist, startTime: '11:00', endTime: '11:30', pricePaise: 50_000 }] },
        },
      });
      await prisma.appointment.create({
        data: {
          branchId: fx.a1, clientId: fx.client, date: new Date(`${shiftIso(today, 2)}T00:00:00Z`), startTime: '11:00', endTime: '11:30', status: 'CANCELLED',
          items: { create: [{ serviceId: fx.haircut, staffId: fx.stylist, startTime: '11:00', endTime: '11:30', pricePaise: 50_000 }] },
        },
      });

      const boss = await as('boss');
      const res = await boss.post(`/staff/${fx.stylist2}/transfer`).send({ toBranchId: fx.a2 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain('1 upcoming appointment');
    });

    it('checks the target branch and the actor’s access', async () => {
      const boss = await as('boss');
      await boss.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: fx.b1 }).expect(404);
      await boss.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: fx.a1 }).expect(400);
      await boss.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: 'nope' }).expect(400);

      const admin = await as('admin');
      await admin.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: fx.a2 }).expect(403);
      const desk = await as('desk');
      await desk.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: fx.a2 }).expect(403);
    });

    it('is blocked when the target branch has staff with the same phone', async () => {
      const helper = await prisma.staff.findFirst({ where: { name: 'Desk Helper' } });
      await prisma.staff.create({
        data: { branchId: fx.a2, kind: 'STAFF', name: 'Namesake', phone: helper.phone, gender: 'MALE', joinedOn: new Date('2026-01-01') },
      });
      const boss = await as('boss');
      const res = await boss.post(`/staff/${helper.id}/transfer`).send({ toBranchId: fx.a2 });
      expect(res.status).toBe(409);
      expect(res.body.error.message).toContain(helper.phone);
    });

    it('moves the staff member and keeps history in the old branch', async () => {
      const boss = await as('boss');
      const res = await boss.post(`/staff/${fx.stylist}/transfer`).send({ toBranchId: fx.a2 }).expect(200);
      expect(res.body.data).toMatchObject({ id: fx.stylist, branchId: fx.a2 });

      const a2Staff = await boss.get('/staff').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(a2Staff.body.data.map((s) => s.id)).toContain(fx.stylist);
      const a1Staff = await boss.get('/staff').expect(200);
      expect(a1Staff.body.data.map((s) => s.id)).not.toContain(fx.stylist);

      expect(await prisma.attendance.count({ where: { staffId: fx.stylist, branchId: fx.a1 } })).toBeGreaterThan(0);
      const salaries = await boss.get(`/salaries?month=${month}`).expect(200);
      expect(salaries.body.data.find((r) => r.staff.id === fx.stylist)).toMatchObject({ commissionPaise: 6_000, paidSalaryPaise: 1_000_000 });
      const lines = await boss.get(`/commissions/${fx.stylist}?from=${monthStart}&to=${today}`).expect(200);
      expect(lines.body.data.lines).toHaveLength(2);

      // Now an A2 staff member: A1 can no longer mark their attendance.
      await boss.put('/attendance').send({ staffId: fx.stylist, date: today, status: 'PRESENT' }).expect(404);
    });
  });
});
