import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { OPENING_BALANCE_COLUMNS } from '../src/services/openingBalanceImport.js';
import { availableSlots } from '../src/services/slots.js';
import { login, resetDatabase, seedBase } from './helpers.js';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const istNow = () => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const atUtc = (iso) => new Date(`${iso}T00:00:00Z`);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

describe('slot calculation (pure)', () => {
  const base = { date: '2026-11-02', today: '2026-11-01', nowTime: '15:00', openTime: '10:00', closeTime: '12:00', durationMin: 30 };
  const free = { busy: [] };

  it('offers 15-minute starts that finish by closing time', () => {
    expect(availableSlots({ ...base, providers: [free] })).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    expect(availableSlots({ ...base, durationMin: 90, providers: [free] })).toEqual(['10:00', '10:15', '10:30']);
    expect(availableSlots({ ...base, durationMin: 150, providers: [free] })).toEqual([]);
  });

  it('needs one provider free for the whole block (half-open intervals)', () => {
    const busy = { busy: [{ start: '10:00', end: '10:30' }, { start: '11:15', end: '12:00' }] };
    expect(availableSlots({ ...base, providers: [busy] })).toEqual(['10:30', '10:45']);
    expect(availableSlots({ ...base, providers: [busy, free] })).toHaveLength(7);
    expect(availableSlots({ ...base, providers: [] })).toEqual([]);
  });

  it('counts bookings without a provider against the free providers', () => {
    const unassigned = [{ start: '10:00', end: '10:30' }];
    expect(availableSlots({ ...base, providers: [free], unassigned })[0]).toBe('10:30');
    expect(availableSlots({ ...base, providers: [free, free], unassigned })[0]).toBe('10:00');
  });

  it('skips holidays, past days, past times today and days beyond the booking window', () => {
    expect(availableSlots({ ...base, isHoliday: true, providers: [free] })).toEqual([]);
    expect(availableSlots({ ...base, date: '2026-10-31', providers: [free] })).toEqual([]);
    expect(availableSlots({ ...base, date: '2026-11-01', nowTime: '10:20', providers: [free] })[0]).toBe('10:30');
    expect(availableSlots({ ...base, date: '2026-11-01', nowTime: '10:30', providers: [free] })[0]).toBe('10:45');
    expect(availableSlots({ ...base, date: '2026-12-31', providers: [free] })).toEqual(['10:00', '10:15', '10:30', '10:45', '11:00', '11:15', '11:30']);
    expect(availableSlots({ ...base, date: '2027-01-01', providers: [free] })).toEqual([]);
  });
});

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('website, online booking, feedback and imports', () => {
  let app;
  let prisma;
  let config;
  let fx;
  let admin;
  let desk;
  let boss;
  const today = istToday();
  const day = shiftIso(today, 2);

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    ({ config } = await import('../src/config.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);

    const hair = fx.category;
    fx.hidden = (await prisma.service.create({
      data: { branchId: fx.a1, categoryId: hair, name: 'Secret treatment', durationMin: 30, pricePaise: 10000, memberPricePaise: 10000, showOnWebsite: false },
    })).id;
    await prisma.service.create({
      data: { branchId: fx.a1, categoryId: hair, name: 'Retired service', durationMin: 30, pricePaise: 10000, memberPricePaise: 10000, isActive: false },
    });
    await prisma.branch.create({ data: { organizationId: fx.orgA, name: 'Closed', slug: 'closed', salonName: 'Closed salon', isActive: false } });

    admin = await login(app, 'admin');
    desk = await login(app, 'desk');
    boss = await login(app, 'boss');
  });

  afterAll(async () => {
    if (fx && config) {
      for (const branchId of [fx.a1, fx.a2]) fs.rmSync(path.join(config.uploadsDir, branchId), { recursive: true, force: true });
    }
    await prisma?.$disconnect();
  });

  const uploadedPath = (imageUrl) => path.join(config.uploadsDir, imageUrl.replace(/^.*\/uploads\//, ''));
  const filesIn = (branchId) => {
    const dir = path.join(config.uploadsDir, branchId);
    return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
  };

  describe('public salon info', () => {
    it('returns the salon without internal ids', async () => {
      const res = await request(app).get('/api/public/a1').expect(200);
      expect(res.body.data).toEqual({
        salonName: 'Salon A', name: 'A1', address: null, phone: null, email: null, website: null,
        openTime: '10:00', closeTime: '20:00', onlineBooking: true,
      });
    });

    it('404s for unknown and inactive branches', async () => {
      await request(app).get('/api/public/nope').expect(404);
      await request(app).get('/api/public/closed').expect(404);
      await request(app).get('/api/public/closed/services').expect(404);
    });

    it('lists active website services grouped by category', async () => {
      const res = await request(app).get('/api/public/a1/services').expect(200);
      expect(res.body.data.categories).toEqual([
        {
          name: 'Hair',
          services: [
            { id: fx.colour, name: 'Hair colour', durationMin: 90, pricePaise: 250000, gender: 'UNISEX' },
            { id: fx.haircut, name: 'Haircut', durationMin: 30, pricePaise: 50000, gender: 'UNISEX' },
          ],
        },
      ]);
    });

    it('sends CORS headers and answers preflight requests', async () => {
      const res = await request(app).get('/api/public/a1').set('Origin', 'https://salon.example').expect(200);
      expect(res.headers['access-control-allow-origin']).toBe('*');
      const preflight = await request(app).options('/api/public/a1/bookings').set('Origin', 'https://salon.example').expect(204);
      expect(preflight.headers['access-control-allow-methods']).toBe('GET,POST,OPTIONS');
      expect(preflight.headers['access-control-allow-headers']).toBe('Content-Type');
    });
  });

  describe('slots', () => {
    const slots = (date, ids) => request(app).get(`/api/public/a1/slots?date=${date}&serviceIds=${ids.join(',')}`);

    it('fits the whole block before closing time', async () => {
      const short = (await slots(day, [fx.haircut]).expect(200)).body.data;
      expect(short.date).toBe(day);
      expect(short.slots[0]).toBe('10:00');
      expect(short.slots.at(-1)).toBe('19:30');
      const long = (await slots(day, [fx.haircut, fx.colour]).expect(200)).body.data.slots;
      expect(long.at(-1)).toBe('18:00');
    });

    it('needs a free provider for the whole block', async () => {
      const book = (staffId) =>
        prisma.appointment.create({
          data: {
            branchId: fx.a1, clientId: fx.client, date: atUtc(day), startTime: '10:00', endTime: '11:00', status: 'BOOKED',
            items: { create: { serviceId: fx.colour, staffId, startTime: '10:00', endTime: '11:00', pricePaise: 250000 } },
          },
        });
      await book(fx.stylist);
      expect((await slots(day, [fx.haircut])).body.data.slots[0]).toBe('10:00');
      await book(fx.stylist2);
      const busy = (await slots(day, [fx.haircut])).body.data.slots;
      expect(busy[0]).toBe('11:00');
      expect((await slots(day, [fx.colour])).body.data.slots[0]).toBe('11:00');

      // Cancelled appointments do not block.
      await prisma.appointment.updateMany({ where: { branchId: fx.a1, date: atUtc(day), startTime: '10:00' }, data: { status: 'CANCELLED' } });
      expect((await slots(day, [fx.haircut])).body.data.slots[0]).toBe('10:00');
    });

    it('is empty on holidays and past days, and never offers past times today', async () => {
      const holiday = shiftIso(today, 3);
      await prisma.holiday.create({ data: { branchId: fx.a1, date: atUtc(holiday), description: 'Diwali' } });
      expect((await slots(holiday, [fx.haircut]).expect(200)).body.data.slots).toEqual([]);
      expect((await slots(shiftIso(today, -1), [fx.haircut]).expect(200)).body.data.slots).toEqual([]);
      expect((await slots(shiftIso(today, 61), [fx.haircut]).expect(200)).body.data.slots).toEqual([]);
      const now = istNow();
      const todays = (await slots(today, [fx.haircut]).expect(200)).body.data.slots;
      expect(todays.every((t) => t > now)).toBe(true);
    });

    it('rejects bad input and services hidden from the website', async () => {
      await slots('tomorrow', [fx.haircut]).expect(400);
      await request(app).get(`/api/public/a1/slots?date=${day}`).expect(400);
      await slots(day, [fx.hidden]).expect(400);
      await slots(day, ['not-a-uuid']).expect(400);
    });
  });

  describe('online booking', () => {
    const book = (body) => request(app).post('/api/public/a1/bookings').send({ date: day, time: '12:00', ...body });

    it('creates a REQUESTED website appointment and a new client', async () => {
      const res = await book({ name: 'Web Person', phone: '93000 00001', email: 'web@example.com', serviceIds: [fx.haircut, fx.colour], notes: 'First visit' })
        .expect(201);
      expect(res.body.data).toMatchObject({ date: day, time: '12:00', endTime: '14:00' });
      expect(res.body.data.reference).toMatch(/^[0-9A-F]{8}$/);
      expect(res.body.data.services.map((s) => s.name)).toEqual(['Haircut', 'Hair colour']);

      const client = await prisma.client.findUnique({ where: { organizationId_phone: { organizationId: fx.orgA, phone: '9300000001' } } });
      expect(client).toMatchObject({ name: 'Web Person', source: 'WEBSITE', gender: 'OTHER', homeBranchId: fx.a1, email: 'web@example.com' });
      expect(client.referralCode).toHaveLength(8);

      const appointment = await prisma.appointment.findFirst({
        where: { clientId: client.id },
        include: { items: { orderBy: { startTime: 'asc' } } },
      });
      expect(appointment.id.slice(0, 8).toUpperCase()).toBe(res.body.data.reference);
      expect(appointment).toMatchObject({ status: 'REQUESTED', source: 'WEBSITE', startTime: '12:00', endTime: '14:00', notes: 'First visit', branchId: fx.a1 });
      expect(appointment.items.map((i) => [i.serviceId, i.staffId, i.startTime, i.endTime, i.pricePaise])).toEqual([
        [fx.haircut, null, '12:00', '12:30', 50000],
        [fx.colour, null, '12:30', '14:00', 250000],
      ]);
    });

    it('reuses an existing client by phone without changing their details', async () => {
      const before = await prisma.client.count();
      await book({ name: 'Someone Else', phone: '9200000001', serviceIds: [fx.haircut] }).expect(201);
      expect(await prisma.client.count()).toBe(before);
      expect((await prisma.client.findUnique({ where: { id: fx.client } })).name).toBe('Test Client');
      expect(await prisma.appointment.count({ where: { clientId: fx.client, status: 'REQUESTED' } })).toBe(1);
    });

    it('rejects a slot that is no longer available', async () => {
      // Two unassigned bookings at 12:00 use up both providers.
      const open = (await request(app).get(`/api/public/a1/slots?date=${day}&serviceIds=${fx.haircut}`)).body.data.slots;
      expect(open).not.toContain('12:00');
      expect(open).toContain('12:30');
      const res = await book({ name: 'Late', phone: '9300000009', serviceIds: [fx.haircut] }).expect(409);
      expect(res.body.error.details).toEqual({ time: 'No longer available' });
    });

    it('validates the request', async () => {
      const res = await book({ name: '', phone: '1', serviceIds: [] }).expect(400);
      expect(Object.keys(res.body.error.details).sort()).toEqual(['name', 'phone', 'serviceIds']);
    });

    it('refuses bookings when online booking is switched off (managers only toggle)', async () => {
      await desk.patch('/api/website/booking').set(BRANCH_HEADER, fx.a1).send({ onlineBooking: false }).expect(403);
      await admin.patch('/api/website/booking').set(BRANCH_HEADER, fx.a1).send({ onlineBooking: false }).expect(200);
      expect((await request(app).get('/api/public/a1')).body.data.onlineBooking).toBe(false);
      const res = await book({ name: 'Off', phone: '9300000008', time: '15:00', serviceIds: [fx.haircut] }).expect(403);
      expect(res.body.error.code).toBe('BOOKING_DISABLED');
      await admin.patch('/api/website/booking').set(BRANCH_HEADER, fx.a1).send({ onlineBooking: true }).expect(200);
      expect((await admin.get('/api/website/info').set(BRANCH_HEADER, fx.a1)).body.data).toEqual({
        name: 'A1', salonName: 'Salon A', slug: 'a1', onlineBooking: true,
      });
    });
  });

  describe('feedback', () => {
    let bill;
    let voided;

    beforeAll(async () => {
      const make = (number, status) =>
        prisma.bill.create({
          data: {
            branchId: fx.a1, number, clientId: fx.client, status, subtotalPaise: 50000, discountPaise: 0, taxPaise: 0,
            totalPaise: 50000, paidPaise: 50000, duePaise: 0, createdById: fx.users.admin,
          },
        });
      bill = await make('A1-900001', 'PAID');
      voided = await make('A1-900002', 'VOID');
    });

    it('shows the visit and accepts one submission per bill', async () => {
      const info = await request(app).get(`/api/public/feedback/${bill.feedbackToken}`).expect(200);
      expect(info.body.data).toMatchObject({ salonName: 'Salon A', clientFirstName: 'Test', billNumber: 'A1-900001', alreadySubmitted: false });

      await request(app).post(`/api/public/feedback/${bill.feedbackToken}`).send({ rating: 9 }).expect(400);
      const res = await request(app)
        .post(`/api/public/feedback/${bill.feedbackToken}`)
        .send({ rating: 4, serviceRating: 5, staffRating: '', comment: 'Lovely haircut' })
        .expect(201);
      expect(res.body.data).toEqual({ rating: 4, serviceRating: 5, staffRating: null, ambienceRating: null, comment: 'Lovely haircut' });

      const saved = await prisma.feedback.findUnique({ where: { billId: bill.id } });
      expect(saved).toMatchObject({ branchId: fx.a1, clientId: fx.client, name: 'Test Client', phone: '9200000001', isApproved: false });

      expect((await request(app).get(`/api/public/feedback/${bill.feedbackToken}`)).body.data.alreadySubmitted).toBe(true);
      await request(app).post(`/api/public/feedback/${bill.feedbackToken}`).send({ rating: 5 }).expect(409);
    });

    it('404s for unknown tokens and void bills', async () => {
      await request(app).get('/api/public/feedback/does-not-exist').expect(404);
      await request(app).get(`/api/public/feedback/${voided.feedbackToken}`).expect(404);
      await request(app).post(`/api/public/feedback/${voided.feedbackToken}`).send({ rating: 5 }).expect(404);
    });

    it('lets managers approve feedback; only approved reviews are public', async () => {
      expect((await request(app).get('/api/public/a1/reviews').expect(200)).body.data).toEqual({ averageRating: null, count: 0, items: [] });

      const pending = (await desk.get('/api/website/feedback?status=pending').set(BRANCH_HEADER, fx.a1).expect(200)).body.data;
      expect(pending.total).toBe(1);
      expect(pending.items[0]).toMatchObject({ rating: 4, client: { id: fx.client, name: 'Test Client' }, bill: { number: 'A1-900001' } });
      expect(pending.summary).toEqual({ averageRating: 4, count: 1, byStars: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 } });

      const id = pending.items[0].id;
      await desk.patch(`/api/website/feedback/${id}`).set(BRANCH_HEADER, fx.a1).send({ isApproved: true }).expect(403);
      await admin.patch(`/api/website/feedback/${id}`).set(BRANCH_HEADER, fx.a1).send({ isApproved: true }).expect(200);
      await boss.patch(`/api/website/feedback/${id}`).set(BRANCH_HEADER, fx.a2).send({ isApproved: false }).expect(404);

      expect((await admin.get('/api/website/feedback?status=pending').set(BRANCH_HEADER, fx.a1)).body.data.total).toBe(0);
      expect((await admin.get('/api/website/feedback?status=approved').set(BRANCH_HEADER, fx.a1)).body.data.total).toBe(1);

      const reviews = (await request(app).get('/api/public/a1/reviews').expect(200)).body.data;
      expect(reviews.averageRating).toBe(4);
      expect(reviews.count).toBe(1);
      expect(reviews.items).toEqual([{ name: 'Test C.', rating: 4, comment: 'Lovely haircut', date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }]);
      expect((await request(app).get('/api/public/a2/reviews')).body.data.count).toBe(0);
    });
  });

  describe('offers', () => {
    let offer;

    it('creates an offer with an uploaded image (managers only)', async () => {
      await desk.post('/api/website/offers').set(BRANCH_HEADER, fx.a1).field('title', 'Nope').expect(403);

      const res = await admin
        .post('/api/website/offers')
        .set(BRANCH_HEADER, fx.a1)
        .field('title', 'Diwali glow')
        .field('description', '20% off facials')
        .field('validTo', shiftIso(today, 10))
        .field('sortOrder', '1')
        .field('isActive', 'true')
        .attach('image', PNG, { filename: 'glow.png', contentType: 'image/png' })
        .expect(201);
      offer = res.body.data;
      expect(offer).toMatchObject({ title: 'Diwali glow', description: '20% off facials', validTo: shiftIso(today, 10), sortOrder: 1, isActive: true });
      expect(offer.imageUrl).toMatch(new RegExp(`^/uploads/${fx.a1}/[0-9a-f-]{36}\\.png$`));
      expect(fs.existsSync(uploadedPath(offer.imageUrl))).toBe(true);

      const served = await request(app).get(offer.imageUrl).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
    });

    it('rejects files that are not images', async () => {
      const before = filesIn(fx.a1).length;
      const text = await admin
        .post('/api/website/offers')
        .set(BRANCH_HEADER, fx.a1)
        .field('title', 'Bad')
        .attach('image', Buffer.from('hello'), { filename: 'notes.txt', contentType: 'text/plain' });
      expect(text.status).toBe(400);
      const fake = await admin
        .post('/api/website/offers')
        .set(BRANCH_HEADER, fx.a1)
        .field('title', 'Bad')
        .attach('image', Buffer.from('<html>not a png</html>'), { filename: 'fake.png', contentType: 'image/png' });
      expect(fake.status).toBe(400);
      const invalid = await admin
        .post('/api/website/offers')
        .set(BRANCH_HEADER, fx.a1)
        .field('title', '')
        .attach('image', PNG, { filename: 'ok.png', contentType: 'image/png' });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.details).toHaveProperty('title');
      expect(filesIn(fx.a1).length).toBe(before);
      expect(await prisma.offer.count()).toBe(1);
    });

    it('shows only active, unexpired offers publicly', async () => {
      await admin.post('/api/website/offers').set(BRANCH_HEADER, fx.a1).send({ title: 'Expired', validTo: shiftIso(today, -1) }).expect(201);
      await admin.post('/api/website/offers').set(BRANCH_HEADER, fx.a1).send({ title: 'Hidden', isActive: false }).expect(201);
      await admin.post('/api/website/offers').set(BRANCH_HEADER, fx.a1).send({ title: 'Today only', validTo: today, sortOrder: 0 }).expect(201);

      expect((await desk.get('/api/website/offers').set(BRANCH_HEADER, fx.a1).expect(200)).body.data).toHaveLength(4);
      const res = await request(app).get('/api/public/a1/offers').expect(200);
      expect(res.body.data.map((o) => o.title)).toEqual(['Today only', 'Diwali glow']);
      expect(res.body.data[1].imageUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/uploads\//);
      expect(res.body.data[1]).not.toHaveProperty('id');
    });

    it('replaces the image on edit and deletes the file with the offer', async () => {
      const oldFile = uploadedPath(offer.imageUrl);
      const res = await admin
        .put(`/api/website/offers/${offer.id}`)
        .set(BRANCH_HEADER, fx.a1)
        .field('title', 'Diwali glow')
        .field('isActive', 'false')
        .attach('image', PNG, { filename: 'new.png', contentType: 'image/png' })
        .expect(200);
      expect(res.body.data.isActive).toBe(false);
      expect(res.body.data.imageUrl).not.toBe(offer.imageUrl);
      expect(fs.existsSync(oldFile)).toBe(false);
      const newFile = uploadedPath(res.body.data.imageUrl);
      expect(fs.existsSync(newFile)).toBe(true);

      await desk.delete(`/api/website/offers/${offer.id}`).set(BRANCH_HEADER, fx.a1).expect(403);
      await admin.delete(`/api/website/offers/${offer.id}`).set(BRANCH_HEADER, fx.a1).expect(204);
      expect(fs.existsSync(newFile)).toBe(false);
    });
  });

  describe('gallery', () => {
    it('uploads several photos, edits captions and deletes files', async () => {
      await admin.post('/api/website/gallery').set(BRANCH_HEADER, fx.a1).field('caption', 'Empty').expect(400);
      const res = await admin
        .post('/api/website/gallery')
        .set(BRANCH_HEADER, fx.a1)
        .field('caption', 'Our studio')
        .attach('images', PNG, { filename: 'one.png', contentType: 'image/png' })
        .attach('images', PNG, { filename: 'two.png', contentType: 'image/png' })
        .expect(201);
      expect(res.body.data).toHaveLength(2);
      const [first, second] = res.body.data;
      expect(first.caption).toBe('Our studio');
      expect(fs.existsSync(uploadedPath(first.imageUrl))).toBe(true);

      await admin.patch(`/api/website/gallery/${second.id}`).set(BRANCH_HEADER, fx.a1).send({ caption: 'Styling floor', sortOrder: -1 }).expect(400);
      await admin.patch(`/api/website/gallery/${second.id}`).set(BRANCH_HEADER, fx.a1).send({ caption: 'Styling floor', sortOrder: 0 }).expect(200);
      await admin.patch(`/api/website/gallery/${first.id}`).set(BRANCH_HEADER, fx.a1).send({ caption: 'Our studio', sortOrder: 5 }).expect(200);

      const pub = (await request(app).get('/api/public/a1/gallery').expect(200)).body.data;
      expect(pub.map((p) => p.caption)).toEqual(['Styling floor', 'Our studio']);
      expect(pub[0]).not.toHaveProperty('id');

      await admin.delete(`/api/website/gallery/${first.id}`).set(BRANCH_HEADER, fx.a1).expect(204);
      expect(fs.existsSync(uploadedPath(first.imageUrl))).toBe(false);
      expect((await desk.get('/api/website/gallery').set(BRANCH_HEADER, fx.a1).expect(200)).body.data).toHaveLength(1);
    });
  });

  describe('branch isolation', () => {
    it('keeps website data per branch', async () => {
      const photo = await prisma.galleryPhoto.findFirst({ where: { branchId: fx.a1 } });
      await admin.get('/api/website/gallery').set(BRANCH_HEADER, fx.a2).expect(403);
      expect((await boss.get('/api/website/gallery').set(BRANCH_HEADER, fx.a2).expect(200)).body.data).toEqual([]);
      expect((await boss.get('/api/website/offers').set(BRANCH_HEADER, fx.a2).expect(200)).body.data).toEqual([]);
      await boss.patch(`/api/website/gallery/${photo.id}`).set(BRANCH_HEADER, fx.a2).send({ caption: 'x' }).expect(404);
      await boss.delete(`/api/website/gallery/${photo.id}`).set(BRANCH_HEADER, fx.a2).expect(404);
      await boss.get('/api/website/gallery').set(BRANCH_HEADER, fx.b1).expect(403);
      expect((await request(app).get('/api/public/a2/gallery')).body.data).toEqual([]);
      expect((await request(app).get('/api/public/b1/services')).body.data.categories).toEqual([]);
    });
  });

  describe('opening balance import', () => {
    async function sheet(rows) {
      const workbook = new ExcelJS.Workbook();
      const ws = workbook.addWorksheet('Opening balances');
      ws.addRow(OPENING_BALANCE_COLUMNS);
      rows.forEach((row) => ws.addRow(row));
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    const upload = (agent, buffer) =>
      agent.post('/api/imports/opening-balances').set(BRANCH_HEADER, fx.a1).attach('file', buffer, 'balances.xlsx');

    it('is for managers only and offers a template', async () => {
      await desk.get('/api/imports/opening-balances/template').set(BRANCH_HEADER, fx.a1).expect(403);
      const res = await admin.get('/api/imports/opening-balances/template').set(BRANCH_HEADER, fx.a1).buffer().expect(200);
      expect(res.headers['content-disposition']).toContain('opening-balances-template.xlsx');
      await desk.post('/api/imports/opening-balances').set(BRANCH_HEADER, fx.a1).expect(403);
      await admin.post('/api/imports/opening-balances').set(BRANCH_HEADER, fx.a1).expect(400);
    });

    it('creates wallet, points and due bills, reports bad rows and skips re-imports', async () => {
      const file = await sheet([
        ['9200000001', 1500, 120, '800.50', 'From old software'],
        ['9999999999', 100, '', '', ''],
        ['abc', 100, '', '', ''],
        ['9300000001', '', 50, '', ''],
        ['9300000001', 10, '', '', ''],
        ['9200000001', -5, '', '', ''],
      ]);
      const res = await upload(admin, file).expect(200);
      expect(res.body.data.created).toBe(2);
      expect(res.body.data.errors.map((e) => e.row)).toEqual([3, 4, 6, 7]);
      expect(res.body.data.errors[0].message).toContain('No client with phone 9999999999');

      const wallet = await prisma.walletEntry.findMany({ where: { clientId: fx.client } });
      expect(wallet).toMatchObject([{ amountPaise: 150000, reason: 'OPENING', branchId: fx.a1, note: 'From old software' }]);
      const points = await prisma.pointsEntry.findMany({ where: { reason: 'OPENING' }, orderBy: { points: 'asc' } });
      expect(points.map((p) => p.points)).toEqual([50, 120]);

      const bills = await prisma.bill.findMany({ where: { items: { some: { kind: 'OPENING_BALANCE' } } }, include: { items: true } });
      expect(bills).toHaveLength(1);
      expect(bills[0]).toMatchObject({
        clientId: fx.client, branchId: fx.a1, status: 'PARTIAL', subtotalPaise: 80050, totalPaise: 80050, duePaise: 80050,
        paidPaise: 0, discountPaise: 0, taxPaise: 0, createdById: fx.users.admin,
      });
      expect(bills[0].number).toMatch(/-\d{6}$/);
      expect(bills[0].items).toMatchObject([{ kind: 'OPENING_BALANCE', name: 'Opening balance', qty: 1, unitPricePaise: 80050, totalPaise: 80050, taxPaise: 0 }]);

      const again = await upload(admin, file).expect(200);
      expect(again.body.data.created).toBe(0);
      expect(again.body.data.errors.filter((e) => e.message.includes('already imported')).map((e) => e.row)).toEqual([2, 5]);
      expect(await prisma.walletEntry.count()).toBe(1);
    });
  });
});
