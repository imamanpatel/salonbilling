import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { login, resetDatabase, seedBase } from './helpers.js';

// Fixed future dates; each test books on its own day so they don't collide.
const DAY = {
  defaults: '2027-03-01',
  conflict: '2027-03-02',
  sameRequest: '2027-03-03',
  holiday: '2027-03-04',
  notify: '2027-03-05',
  advance: '2027-03-06',
  status: '2027-03-08',
  restore: '2027-03-09',
  billed: '2027-03-10',
  reschedule: '2027-03-11',
  dayView: '2027-03-12',
  isolation: '2027-03-13',
};

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('appointments', () => {
  let app;
  let prisma;
  let fx;
  let desk;
  let boss;

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    desk = await login(app, 'desk');
    boss = await login(app, 'boss');
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const item = (overrides = {}) => ({ serviceId: fx.haircut, staffId: fx.stylist, startTime: '10:00', ...overrides });
  const body = (date, items, extra = {}) => ({ clientId: fx.client, date, source: 'PHONE', items, ...extra });
  const book = (payload, agent = desk, branchId = fx.a1) => agent.post('/api/appointments').set(BRANCH_HEADER, branchId).send(payload);
  const setStatus = (id, payload) => desk.patch(`/api/appointments/${id}/status`).set(BRANCH_HEADER, fx.a1).send(payload);

  it('books with default end times and prices from the service', async () => {
    const res = await book(
      body(DAY.defaults, [item(), item({ serviceId: fx.colour, staffId: null, startTime: '10:30' })], { notes: 'Prefers tea' }),
    );
    expect(res.status).toBe(201);
    const a = res.body.data;
    expect(a).toMatchObject({
      clientId: fx.client,
      client: { id: fx.client, name: 'Test Client', phone: '9200000001' },
      date: DAY.defaults,
      startTime: '10:00',
      endTime: '12:00',
      status: 'BOOKED',
      source: 'PHONE',
      notes: 'Prefers tea',
      advancePaise: 0,
      totalPaise: 300000,
      payments: [],
    });
    expect(a.items).toEqual([
      expect.objectContaining({
        serviceId: fx.haircut, service: expect.objectContaining({ name: 'Haircut' }), staffId: fx.stylist,
        staff: { id: fx.stylist, name: 'Stylist One' }, startTime: '10:00', endTime: '10:30', pricePaise: 50000,
      }),
      expect.objectContaining({ serviceId: fx.colour, staffId: null, staff: null, startTime: '10:30', endTime: '12:00', pricePaise: 250000 }),
    ]);

    // Explicit end time and price win over the defaults.
    const custom = await book(body(DAY.defaults, [item({ staffId: fx.stylist2, startTime: '13:00', endTime: '13:45', pricePaise: 45000 })]));
    expect(custom.status).toBe(201);
    expect(custom.body.data.items[0]).toMatchObject({ endTime: '13:45', pricePaise: 45000 });
  });

  it('validates the payload', async () => {
    const res = await book(body(DAY.defaults, [item({ startTime: '11:00', endTime: '10:00' })]));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ 'items.0.endTime': 'Must be after the start time' });

    const empty = await book(body(DAY.defaults, []));
    expect(empty.status).toBe(400);
    expect(empty.body.error.details.items).toBe('Add at least one service');

    const late = await book(body(DAY.defaults, [item({ serviceId: fx.colour, staffId: null, startTime: '23:00' })]));
    expect(late.status).toBe(400);
    expect(late.body.error.details).toEqual({ 'items.0.endTime': 'Ends after midnight' });
  });

  it('rejects double-booking a provider against other appointments (half-open slots)', async () => {
    const first = await book(body(DAY.conflict, [item({ startTime: '11:00' })]));
    expect(first.status).toBe(201);

    const clash = await book(body(DAY.conflict, [item({ startTime: '11:15' })]));
    expect(clash.status).toBe(409);
    expect(clash.body.error.code).toBe('CONFLICT');
    expect(clash.body.error.details).toEqual({ 'items.0.staffId': 'Stylist One is booked 11:00–11:30' });

    // Back-to-back is fine, as is another provider or no provider at the same time.
    await book(body(DAY.conflict, [item({ startTime: '11:30' })])).expect(201);
    await book(body(DAY.conflict, [item({ staffId: fx.stylist2, startTime: '11:15' })])).expect(201);
    await book(body(DAY.conflict, [item({ staffId: null, startTime: '11:15' })])).expect(201);

    // Cancelled appointments free their slot.
    await setStatus(first.body.data.id, { status: 'CANCELLED', cancelReason: 'Client called off' }).expect(200);
    await book(body(DAY.conflict, [item({ startTime: '11:00' })])).expect(201);
  });

  it('rejects overlapping rows for the same provider within one request', async () => {
    const res = await book(body(DAY.sameRequest, [item({ startTime: '10:00' }), item({ serviceId: fx.colour, startTime: '10:15' })]));
    expect(res.status).toBe(409);
    expect(res.body.error.details).toEqual({ 'items.1.staffId': 'Stylist One is booked 10:00–10:30' });
    expect(await prisma.appointment.count({ where: { date: new Date(`${DAY.sameRequest}T00:00:00Z`) } })).toBe(0);
  });

  it('rejects bookings on a branch holiday', async () => {
    await prisma.holiday.create({ data: { branchId: fx.a1, date: new Date(`${DAY.holiday}T00:00:00Z`), description: 'Holi' } });
    const res = await book(body(DAY.holiday, [item()]));
    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual({ date: 'Closed: Holi' });
  });

  it('rejects services, providers and clients from elsewhere', async () => {
    const other = await prisma.client.create({
      data: { organizationId: fx.orgB, name: 'Other Org', phone: '9300000001', gender: 'MALE', referralCode: 'OTHERORG' },
    });
    const wrongClient = await book({ ...body(DAY.isolation, [item()]), clientId: other.id });
    expect(wrongClient.status).toBe(400);
    expect(wrongClient.body.error.details).toEqual({ clientId: 'Pick a valid client' });

    // A2 has neither A1's services nor its stylists.
    const wrongBranch = await book(body(DAY.isolation, [item()]), boss, fx.a2);
    expect(wrongBranch.status).toBe(400);
    expect(wrongBranch.body.error.details).toEqual({ 'items.0.serviceId': 'Pick a valid service' });

    const receptionist = await prisma.staff.create({
      data: { branchId: fx.a1, kind: 'STAFF', name: 'Reception', phone: '9100000009', gender: 'FEMALE', joinedOn: new Date('2026-01-01') },
    });
    const notProvider = await book(body(DAY.isolation, [item({ staffId: receptionist.id })]));
    expect(notProvider.status).toBe(400);
    expect(notProvider.body.error.details).toEqual({ 'items.0.staffId': 'Pick an active service provider' });
  });

  it('keeps appointments inside their branch', async () => {
    const created = await book(body(DAY.isolation, [item()]));
    expect(created.status).toBe(201);
    const id = created.body.data.id;

    await boss.get(`/api/appointments/${id}`).set(BRANCH_HEADER, fx.a2).expect(404);
    await boss.patch(`/api/appointments/${id}/status`).set(BRANCH_HEADER, fx.a2).send({ status: 'CHECKED_IN' }).expect(404);
    await boss.put(`/api/appointments/${id}`).set(BRANCH_HEADER, fx.a2).send(body(DAY.isolation, [item()])).expect(404);
    await boss.post(`/api/appointments/${id}/advance`).set(BRANCH_HEADER, fx.a2).send({ amountPaise: 100, method: 'CASH' }).expect(404);

    const day = await boss.get(`/api/appointments?date=${DAY.isolation}`).set(BRANCH_HEADER, fx.a2).expect(200);
    expect(day.body.data.appointments).toEqual([]);
    const list = await boss.get(`/api/appointments?clientId=${fx.client}`).set(BRANCH_HEADER, fx.a2).expect(200);
    expect(list.body.data.total).toBe(0);

    await boss.get(`/api/appointments/${id}`).set(BRANCH_HEADER, fx.a1).expect(200);
  });

  it('records advances at booking time and later', async () => {
    const created = await book(body(DAY.advance, [item()], { advance: { amountPaise: 20000, method: 'UPI', reference: 'UTR123' } }));
    expect(created.status).toBe(201);
    const a = created.body.data;
    expect(a.advancePaise).toBe(20000);
    expect(a.payments).toEqual([
      expect.objectContaining({ kind: 'ADVANCE', method: 'UPI', amountPaise: 20000, reference: 'UTR123', billId: null }),
    ]);
    const payment = await prisma.payment.findFirst({ where: { appointmentId: a.id } });
    expect(payment).toMatchObject({ branchId: fx.a1, clientId: fx.client, kind: 'ADVANCE', createdById: fx.users.desk });

    const extra = await desk.post(`/api/appointments/${a.id}/advance`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 5000, method: 'CASH' });
    expect(extra.status).toBe(201);
    expect(extra.body.data).toMatchObject({ kind: 'ADVANCE', method: 'CASH', amountPaise: 5000 });

    const bad = await desk.post(`/api/appointments/${a.id}/advance`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 0, method: 'WALLET' });
    expect(bad.status).toBe(400);
    expect(Object.keys(bad.body.error.details).sort()).toEqual(['amountPaise', 'method']);

    const detail = await desk.get(`/api/appointments/${a.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
    expect(detail.body.data.advancePaise).toBe(25000);
    expect(detail.body.data.payments).toHaveLength(2);

    await setStatus(a.id, { status: 'CANCELLED', cancelReason: 'Sick' }).expect(200);
    await desk.post(`/api/appointments/${a.id}/advance`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 100, method: 'CASH' }).expect(409);
  });

  it('follows the allowed status transitions', async () => {
    const { id } = (await book(body(DAY.status, [item()]))).body.data;

    const checkedIn = await setStatus(id, { status: 'CHECKED_IN' });
    expect(checkedIn.status).toBe(200);
    expect(checkedIn.body.data.status).toBe('CHECKED_IN');

    await setStatus(id, { status: 'NO_SHOW' }).expect(409);
    await setStatus(id, { status: 'BILLED' }).expect(409);
    await setStatus(id, { status: 'BOOKED' }).expect(200);
    await setStatus(id, { status: 'NO_SHOW' }).expect(200);
    await setStatus(id, { status: 'CHECKED_IN' }).expect(409);
    await setStatus(id, { status: 'BOOKED' }).expect(200);

    const noReason = await setStatus(id, { status: 'CANCELLED' });
    expect(noReason.status).toBe(400);
    expect(noReason.body.error.details).toEqual({ cancelReason: 'Give a reason for cancelling' });

    const cancelled = await setStatus(id, { status: 'CANCELLED', cancelReason: 'Running late, will rebook' });
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', cancelReason: 'Running late, will rebook' });

    const restored = await setStatus(id, { status: 'BOOKED' });
    expect(restored.body.data).toMatchObject({ status: 'BOOKED', cancelReason: null });

    // Requested (online) bookings can be confirmed.
    const requested = await prisma.appointment.create({
      data: {
        branchId: fx.a1, clientId: fx.client, date: new Date(`${DAY.status}T00:00:00Z`), startTime: '15:00', endTime: '15:30',
        status: 'REQUESTED', source: 'WEBSITE', items: { create: [{ serviceId: fx.haircut, startTime: '15:00', endTime: '15:30', pricePaise: 50000 }] },
      },
    });
    await setStatus(requested.id, { status: 'CHECKED_IN' }).expect(409);
    const confirmed = await setStatus(requested.id, { status: 'BOOKED' });
    expect(confirmed.body.data.status).toBe('BOOKED');
  });

  it('re-checks conflicts when restoring a cancelled appointment', async () => {
    const first = (await book(body(DAY.restore, [item()]))).body.data;
    await setStatus(first.id, { status: 'CANCELLED', cancelReason: 'Clash' }).expect(200);
    await book(body(DAY.restore, [item({ startTime: '10:15' })])).expect(201);

    const restore = await setStatus(first.id, { status: 'BOOKED' });
    expect(restore.status).toBe(409);
    expect(restore.body.error.details).toEqual({ 'items.0.staffId': 'Stylist One is booked 10:15–10:45' });
  });

  it('treats billed appointments as read-only', async () => {
    const { id } = (await book(body(DAY.billed, [item()]))).body.data;
    await prisma.appointment.update({ where: { id }, data: { status: 'BILLED' } });

    for (const status of ['BOOKED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW']) {
      const res = await setStatus(id, { status, cancelReason: 'x' });
      expect(res.status).toBe(409);
    }
    await desk.put(`/api/appointments/${id}`).set(BRANCH_HEADER, fx.a1).send(body(DAY.billed, [item({ startTime: '12:00' })])).expect(409);
    await desk.post(`/api/appointments/${id}/advance`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 100, method: 'CASH' }).expect(409);

    // Billed appointments no longer block the provider's slot.
    await book(body(DAY.billed, [item()])).expect(201);
  });

  it('reschedules, replacing items and checking conflicts against everyone but itself', async () => {
    const mine = (await book(body(DAY.reschedule, [item({ startTime: '10:00' })], { advance: { amountPaise: 1000, method: 'CASH' } }))).body.data;
    await book(body(DAY.reschedule, [item({ startTime: '12:00' })])).expect(201);
    const put = (payload) => desk.put(`/api/appointments/${mine.id}`).set(BRANCH_HEADER, fx.a1).send(payload);

    // Overlapping only its own old slot is fine.
    const moved = await put(body(DAY.reschedule, [item({ startTime: '10:15' }), item({ serviceId: fx.colour, staffId: fx.stylist2, startTime: '10:15' })]));
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ startTime: '10:15', endTime: '11:45', advancePaise: 1000 });
    expect(moved.body.data.items).toHaveLength(2);
    expect(await prisma.appointmentItem.count({ where: { appointmentId: mine.id } })).toBe(2);

    const clash = await put(body(DAY.reschedule, [item({ startTime: '11:45' })]));
    expect(clash.status).toBe(409);
    expect(clash.body.error.details).toEqual({ 'items.0.staffId': 'Stylist One is booked 12:00–12:30' });

    // Moving to another day works and the old items are gone.
    const nextDay = await put(body(DAY.dayView, [item({ staffId: fx.stylist2, startTime: '16:00' })]));
    expect(nextDay.status).toBe(200);
    expect(nextDay.body.data).toMatchObject({ date: DAY.dayView, startTime: '16:00', endTime: '16:30' });
    expect(await prisma.appointmentItem.count({ where: { appointmentId: mine.id } })).toBe(1);

    await setStatus(mine.id, { status: 'NO_SHOW' }).expect(200);
    await put(body(DAY.dayView, [item({ startTime: '17:00' })])).expect(409);
  });

  it('returns the day view with providers, holiday flag and appointments', async () => {
    await book(body(DAY.dayView, [item({ startTime: '09:30' })], { advance: { amountPaise: 30000, method: 'CARD' } })).expect(201);
    const res = await desk.get(`/api/appointments?date=${DAY.dayView}`).set(BRANCH_HEADER, fx.a1).expect(200);
    const day = res.body.data;
    expect(day).toMatchObject({ date: DAY.dayView, openTime: '10:00', closeTime: '20:00', isHoliday: false, holiday: null });
    expect(day.providers.map((p) => p.name)).toEqual(['Stylist One', 'Stylist Two']);
    expect(Object.keys(day.providers[0]).sort()).toEqual(['designation', 'id', 'isActive', 'name', 'shiftEnd', 'shiftStart']);
    // Includes every status (the rescheduled no-show from the previous test) in start-time order.
    expect(day.appointments.map((a) => [a.startTime, a.status])).toEqual([['09:30', 'BOOKED'], ['16:00', 'NO_SHOW']]);
    expect(day.appointments[0]).toMatchObject({
      client: { id: fx.client, name: 'Test Client', phone: '9200000001', email: null },
      advancePaise: 30000,
      items: [expect.objectContaining({ service: { id: fx.haircut, name: 'Haircut', durationMin: 30 }, staff: { id: fx.stylist, name: 'Stylist One' } })],
    });

    const holiday = await desk.get(`/api/appointments?date=${DAY.holiday}`).set(BRANCH_HEADER, fx.a1).expect(200);
    expect(holiday.body.data).toMatchObject({ isHoliday: true, holiday: { date: DAY.holiday, description: 'Holi' } });

    await desk.get('/api/appointments?date=31-10-2026').set(BRANCH_HEADER, fx.a1).expect(400);
  });

  it('lists a client\'s appointments newest first with filters', async () => {
    const res = await desk.get(`/api/appointments?clientId=${fx.client}&pageSize=5`).set(BRANCH_HEADER, fx.a1).expect(200);
    expect(res.body.data).toMatchObject({ page: 1, pageSize: 5 });
    expect(res.body.data.total).toBeGreaterThan(5);
    const dates = res.body.data.items.map((a) => a.date);
    expect(dates).toEqual([...dates].sort().reverse());

    const cancelled = await desk.get(`/api/appointments?status=CANCELLED&from=${DAY.conflict}&to=${DAY.advance}`).set(BRANCH_HEADER, fx.a1);
    expect(cancelled.body.data.items.map((a) => a.date)).toEqual([DAY.advance, DAY.conflict]);
  });

  it('queues a confirmation message when asked to', async () => {
    const silent = await book(body(DAY.notify, [item({ startTime: '09:00' })]));
    expect(silent.status).toBe(201);
    expect(await prisma.messageLog.count({ where: { clientId: fx.client } })).toBe(0);

    await book(body(DAY.notify, [item({ startTime: '10:00' })], { notifyClient: true })).expect(201);
    const messages = await prisma.messageLog.findMany({ where: { clientId: fx.client } });
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      branchId: fx.a1,
      kind: 'APPOINTMENT_CONFIRMATION',
      recipient: '9200000001',
      status: 'QUEUED',
      body: 'Hi Test, your appointment at Salon A is confirmed for 5 Mar 2027 at 10:00.',
    });
  });
});
