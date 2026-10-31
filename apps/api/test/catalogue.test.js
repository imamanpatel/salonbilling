import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { login, PASSWORD, resetDatabase, seedBase } from './helpers.js';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const dbDate = (iso) => new Date(`${iso}T00:00:00.000Z`);

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('catalogue extras', () => {
  let app;
  let prisma;
  let fx;
  let admin;
  let desk;
  let boss;
  let billNo = 0;

  const call = (agent, method, path, branchId = fx.a1) => agent[method](`/api${path}`).set(BRANCH_HEADER, branchId);

  const seedBill = (extra) =>
    prisma.bill.create({
      data: {
        branchId: fx.a1, number: `T-${++billNo}`, clientId: fx.client, status: 'PAID', subtotalPaise: 100000, discountPaise: 0,
        taxPaise: 0, totalPaise: 100000, paidPaise: 100000, duePaise: 0, createdById: fx.users.admin, ...extra,
      },
    });

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    await prisma.user.create({
      data: {
        organizationId: fx.orgB, name: 'bee', username: 'bee', passwordHash: await bcrypt.hash(PASSWORD, 4), role: 'ADMIN',
        branches: { create: [{ branchId: fx.b1 }] },
      },
    });
    [admin, desk, boss] = await Promise.all([login(app, 'admin'), login(app, 'desk'), login(app, 'boss')]);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('packages', () => {
    let pkg;

    it('creates a package with computed services value', async () => {
      const res = await call(admin, 'post', '/packages')
        .send({
          name: ' Hair care ', pricePaise: 300000, validityDays: 180,
          items: [{ serviceId: fx.haircut, qty: 3 }, { serviceId: fx.colour, qty: 1 }],
        })
        .expect(201);
      pkg = res.body.data;
      expect(pkg).toMatchObject({ name: 'Hair care', description: null, pricePaise: 300000, validityDays: 180, isActive: true, servicesValuePaise: 400000, soldCount: 0 });
      expect(pkg.items.map((i) => [i.service.name, i.qty])).toEqual([['Hair colour', 1], ['Haircut', 3]]);
      expect(pkg.items[0].service).toEqual({ id: fx.colour, name: 'Hair colour', pricePaise: 250000 });
    });

    it('rejects duplicate names, duplicate services and services outside the branch', async () => {
      const body = { name: 'Hair care', pricePaise: 1000, validityDays: 30, items: [{ serviceId: fx.haircut, qty: 1 }] };
      const dup = await call(admin, 'post', '/packages').send(body);
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ name: 'Already exists' });

      const twice = await call(admin, 'post', '/packages').send({ ...body, name: 'Twice', items: [{ serviceId: fx.haircut, qty: 1 }, { serviceId: fx.haircut, qty: 2 }] });
      expect(twice.status).toBe(400);
      expect(twice.body.error.details).toEqual({ 'items.1.serviceId': 'This service is already in the package' });

      const category = await prisma.serviceCategory.create({ data: { branchId: fx.a2, name: 'Skin' } });
      const foreign = await prisma.service.create({ data: { branchId: fx.a2, categoryId: category.id, name: 'Facial', durationMin: 60, pricePaise: 150000, memberPricePaise: 150000 } });
      const other = await call(admin, 'post', '/packages').send({ ...body, name: 'Foreign', items: [{ serviceId: fx.haircut, qty: 1 }, { serviceId: foreign.id, qty: 1 }] });
      expect(other.status).toBe(400);
      expect(other.body.error.details).toEqual({ 'items.1.serviceId': 'Pick an active service of this branch' });

      const inactive = await prisma.service.create({ data: { branchId: fx.a1, categoryId: fx.category, name: 'Old perm', durationMin: 60, pricePaise: 100000, memberPricePaise: 100000, isActive: false } });
      const res = await call(admin, 'post', '/packages').send({ ...body, name: 'Inactive', items: [{ serviceId: inactive.id, qty: 1 }] });
      expect(res.status).toBe(400);

      const invalid = await call(admin, 'post', '/packages').send({ name: '', pricePaise: -1, validityDays: 4000, items: [] });
      expect(invalid.status).toBe(400);
      expect(invalid.body.error.details).toMatchObject({ name: 'Package name is required', pricePaise: 'Cannot be negative', validityDays: 'At most 10 years', items: 'Add at least one service' });
    });

    it('lets the front desk read but not write', async () => {
      const list = await call(desk, 'get', '/packages').expect(200);
      expect(list.body.data.map((p) => p.name)).toEqual(['Hair care']);
      await call(desk, 'post', '/packages').send({ name: 'X', pricePaise: 1, validityDays: 1, items: [{ serviceId: fx.haircut, qty: 1 }] }).expect(403);
      await call(desk, 'put', `/packages/${pkg.id}`).send({}).expect(403);
      await call(desk, 'patch', `/packages/${pkg.id}/status`).send({ isActive: false }).expect(403);
    });

    it('replaces items on update and counts packages sold', async () => {
      const res = await call(admin, 'put', `/packages/${pkg.id}`)
        .send({ name: 'Hair care', description: 'Colour twice', pricePaise: 450000, validityDays: 90, items: [{ serviceId: fx.colour, qty: 2 }] })
        .expect(200);
      expect(res.body.data).toMatchObject({ description: 'Colour twice', servicesValuePaise: 500000 });
      expect(res.body.data.items).toHaveLength(1);
      expect(await prisma.packageItem.count({ where: { packageId: pkg.id } })).toBe(1);

      await prisma.clientPackage.create({
        data: { clientId: fx.client, packageId: pkg.id, branchId: fx.a1, purchasedOn: dbDate(istToday()), expiresOn: dbDate(shiftIso(istToday(), 90)) },
      });
      const list = await call(admin, 'get', '/packages').expect(200);
      expect(list.body.data[0].soldCount).toBe(1);
    });

    it('activates and deactivates, filtered by status', async () => {
      const off = await call(admin, 'patch', `/packages/${pkg.id}/status`).send({ isActive: false }).expect(200);
      expect(off.body.data.isActive).toBe(false);
      expect((await call(admin, 'get', '/packages').expect(200)).body.data).toEqual([]);
      expect((await call(admin, 'get', '/packages?status=inactive').expect(200)).body.data).toHaveLength(1);
      expect((await call(admin, 'get', '/packages?status=all').expect(200)).body.data).toHaveLength(1);
      await call(admin, 'patch', `/packages/${pkg.id}/status`).send({ isActive: true }).expect(200);
    });

    it('keeps packages inside their branch', async () => {
      expect((await call(boss, 'get', '/packages?status=all', fx.a2).expect(200)).body.data).toEqual([]);
      await call(boss, 'patch', `/packages/${pkg.id}/status`, fx.a2).send({ isActive: false }).expect(404);
      await call(boss, 'put', `/packages/${pkg.id}`, fx.a2)
        .send({ name: 'Hijack', pricePaise: 1, validityDays: 1, items: [{ serviceId: fx.haircut, qty: 1 }] })
        .expect(404);
    });
  });

  describe('memberships', () => {
    let plan;
    const body = {
      name: 'Gold', description: 'Yearly', pricePaise: 500000, durationDays: 365, useMemberPrices: true,
      productDiscountPct: 10, packageDiscountPct: 5.5, pointsMultiplier: 2, rewardPoints: 100,
    };

    it('creates plans and validates benefits', async () => {
      const res = await call(admin, 'post', '/memberships').send(body).expect(201);
      plan = res.body.data;
      expect(plan).toMatchObject({ ...body, isActive: true, activeMembers: 0 });

      const dup = await call(admin, 'post', '/memberships').send(body);
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ name: 'Already exists' });

      const bad = await call(admin, 'post', '/memberships').send({ ...body, name: 'Silver', pointsMultiplier: 6, productDiscountPct: 120, durationDays: 0 });
      expect(bad.status).toBe(400);
      expect(bad.body.error.details).toEqual({ durationDays: 'At least 1 day', productDiscountPct: 'Cannot exceed 100', pointsMultiplier: 'At most 5×' });

      await call(desk, 'post', '/memberships').send({ ...body, name: 'Desk plan' }).expect(403);
    });

    it('counts active members and lists members by status', async () => {
      const today = istToday();
      const second = await prisma.client.create({ data: { organizationId: fx.orgA, homeBranchId: fx.a1, name: 'Second Client', phone: '9200000002', gender: 'MALE', referralCode: 'SECOND01' } });
      const third = await prisma.client.create({ data: { organizationId: fx.orgA, homeBranchId: fx.a1, name: 'Third Client', phone: '9200000003', gender: 'MALE', referralCode: 'THIRD001' } });
      const member = (clientId, startsOn, endsOn, extra = {}) =>
        prisma.clientMembership.create({ data: { clientId, planId: plan.id, branchId: fx.a1, startsOn: dbDate(startsOn), endsOn: dbDate(endsOn), ...extra } });
      await member(fx.client, shiftIso(today, -10), today);
      await member(second.id, shiftIso(today, -400), shiftIso(today, -1));
      await member(third.id, shiftIso(today, -5), shiftIso(today, 360), { cancelledAt: new Date() });

      const plans = await call(desk, 'get', '/memberships').expect(200);
      expect(plans.body.data[0].activeMembers).toBe(1);

      const active = await call(desk, 'get', '/memberships/members').expect(200);
      expect(active.body.data).toMatchObject({ total: 1, page: 1, pageSize: 25 });
      expect(active.body.data.items[0]).toMatchObject({
        client: { id: fx.client, name: 'Test Client', phone: '9200000001' }, planName: 'Gold', startsOn: shiftIso(today, -10), endsOn: today, active: true,
      });

      const expired = await call(desk, 'get', '/memberships/members?status=expired').expect(200);
      expect(expired.body.data.items.map((m) => m.client.name).sort()).toEqual(['Second Client', 'Third Client']);
      expect(expired.body.data.items.every((m) => m.active === false)).toBe(true);

      const all = await call(desk, 'get', '/memberships/members?status=all&pageSize=2').expect(200);
      expect(all.body.data).toMatchObject({ total: 3, pageSize: 2 });
      expect(all.body.data.items).toHaveLength(2);

      expect((await call(boss, 'get', '/memberships/members?status=all', fx.a2).expect(200)).body.data.total).toBe(0);
    });

    it('updates and toggles plans within the branch', async () => {
      const res = await call(admin, 'put', `/memberships/${plan.id}`).send({ ...body, pricePaise: 600000, useMemberPrices: false }).expect(200);
      expect(res.body.data).toMatchObject({ pricePaise: 600000, useMemberPrices: false, activeMembers: 1 });
      await call(admin, 'patch', `/memberships/${plan.id}/status`).send({ isActive: false }).expect(200);
      expect((await call(admin, 'get', '/memberships').expect(200)).body.data).toEqual([]);
      expect((await call(admin, 'get', '/memberships?status=inactive').expect(200)).body.data).toHaveLength(1);
      await call(boss, 'put', `/memberships/${plan.id}`, fx.a2).send(body).expect(404);
      expect((await call(boss, 'get', '/memberships?status=all', fx.a2).expect(200)).body.data).toEqual([]);
    });
  });

  describe('coupons', () => {
    let coupon;
    const percentCoupon = {
      code: ' diwali-10 ', description: 'Festive', discountType: 'PERCENT', discountPct: 10, discountPaise: 999, minBillPaise: 100000,
      maxDiscountPaise: 50000, validFrom: '2026-10-01', validTo: '2026-11-30', usageLimitPerClient: 1, totalUsageLimit: 100,
    };

    it('creates a percent coupon with a normalized code', async () => {
      const res = await call(admin, 'post', '/coupons').send(percentCoupon).expect(201);
      coupon = res.body.data;
      expect(coupon).toMatchObject({
        code: 'DIWALI-10', discountType: 'PERCENT', discountPct: 10, discountPaise: null, maxDiscountPaise: 50000,
        validFrom: '2026-10-01', validTo: '2026-11-30', usedCount: 0, isActive: true,
      });
    });

    it('validates the conditional fields', async () => {
      const flat = await call(admin, 'post', '/coupons').send({ code: 'FLAT200', discountType: 'FLAT', discountPct: 10 });
      expect(flat.status).toBe(400);
      expect(flat.body.error.details).toEqual({ discountPaise: 'Enter the discount amount' });

      const pct = await call(admin, 'post', '/coupons').send({ code: 'PCT', discountType: 'PERCENT', discountPct: '' });
      expect(pct.body.error.details).toEqual({ discountPct: 'Enter the discount percentage' });

      const over = await call(admin, 'post', '/coupons').send({ code: 'PCT', discountType: 'PERCENT', discountPct: 150 });
      expect(over.body.error.details).toEqual({ discountPct: 'Cannot exceed 100' });

      const dates = await call(admin, 'post', '/coupons').send({ code: 'DATES', discountType: 'FLAT', discountPaise: 100, validFrom: '2026-12-01', validTo: '2026-11-01' });
      expect(dates.body.error.details).toEqual({ validTo: 'Must be on or after the start date' });

      const code = await call(admin, 'post', '/coupons').send({ code: 'no spaces!', discountType: 'FLAT', discountPaise: 100 });
      expect(code.body.error.details).toEqual({ code: '3–20 letters, numbers or dashes' });

      const dup = await call(admin, 'post', '/coupons').send({ code: 'Diwali-10', discountType: 'FLAT', discountPaise: 100 });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ code: 'Already exists' });
    });

    it('counts uses on non-void bills', async () => {
      await seedBill({ couponId: coupon.id });
      await seedBill({ couponId: coupon.id, status: 'PARTIAL' });
      await seedBill({ couponId: coupon.id, status: 'VOID', voidedAt: new Date() });
      const list = await call(desk, 'get', '/coupons').expect(200);
      expect(list.body.data[0]).toMatchObject({ code: 'DIWALI-10', usedCount: 2 });
    });

    it('updates, toggles and keeps writes to managers', async () => {
      await call(desk, 'post', '/coupons').send({ code: 'DESK', discountType: 'FLAT', discountPaise: 100 }).expect(403);
      await call(desk, 'put', `/coupons/${coupon.id}`).send(percentCoupon).expect(403);
      await call(desk, 'patch', `/coupons/${coupon.id}/status`).send({ isActive: false }).expect(403);

      const res = await call(admin, 'put', `/coupons/${coupon.id}`).send({ ...percentCoupon, discountType: 'FLAT', discountPaise: 20000 }).expect(200);
      expect(res.body.data).toMatchObject({ discountType: 'FLAT', discountPct: null, discountPaise: 20000, maxDiscountPaise: null, usedCount: 2 });

      await call(admin, 'patch', `/coupons/${coupon.id}/status`).send({ isActive: false }).expect(200);
      expect((await call(admin, 'get', '/coupons').expect(200)).body.data).toEqual([]);
      expect((await call(admin, 'get', '/coupons?status=all').expect(200)).body.data).toHaveLength(1);
    });

    it('scopes codes to the branch', async () => {
      expect((await call(boss, 'get', '/coupons?status=all', fx.a2).expect(200)).body.data).toEqual([]);
      await call(boss, 'post', '/coupons', fx.a2).send({ code: 'DIWALI-10', discountType: 'FLAT', discountPaise: 100 }).expect(201);
      await call(boss, 'put', `/coupons/${coupon.id}`, fx.a2).send(percentCoupon).expect(404);
    });
  });

  describe('gift cards', () => {
    let card;
    let orgBCard;

    it('issues a card with a random code and full balance', async () => {
      const expiresOn = shiftIso(istToday(), 365);
      const res = await call(admin, 'post', '/gift-cards').send({ initialPaise: 100000, clientId: fx.client, expiresOn }).expect(201);
      card = res.body.data;
      expect(card.code).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
      expect(card).toMatchObject({
        organizationId: fx.orgA, initialPaise: 100000, balancePaise: 100000, expiresOn, isActive: true, status: 'ACTIVE',
        client: { id: fx.client, name: 'Test Client', phone: '9200000001' },
      });

      const anonymous = await call(admin, 'post', '/gift-cards').send({ initialPaise: 50000 }).expect(201);
      expect(anonymous.body.data).toMatchObject({ client: null, clientId: null, expiresOn: null });
    });

    it('validates issue requests', async () => {
      const small = await call(admin, 'post', '/gift-cards').send({ initialPaise: 99 });
      expect(small.status).toBe(400);
      expect(small.body.error.details).toEqual({ initialPaise: 'At least ₹1' });

      const past = await call(admin, 'post', '/gift-cards').send({ initialPaise: 1000, expiresOn: shiftIso(istToday(), -1) });
      expect(past.body.error.details).toEqual({ expiresOn: 'Cannot be in the past' });

      const bClient = await prisma.client.create({ data: { organizationId: fx.orgB, name: 'B Client', phone: '9300000001', gender: 'FEMALE', referralCode: 'BCLIENT1' } });
      const foreign = await call(admin, 'post', '/gift-cards').send({ initialPaise: 1000, clientId: bClient.id });
      expect(foreign.body.error.details).toEqual({ clientId: 'Pick a valid client' });

      await call(desk, 'post', '/gift-cards').send({ initialPaise: 1000 }).expect(403);
    });

    it('is shared across the organisation but not with other organisations', async () => {
      orgBCard = await prisma.giftCard.create({ data: { organizationId: fx.orgB, code: 'ORGBCARD2345', initialPaise: 1000, balancePaise: 1000 } });

      const fromA2 = await call(boss, 'get', '/gift-cards', fx.a2).expect(200);
      expect(fromA2.body.data.total).toBe(2);
      expect(fromA2.body.data.items.map((c) => c.code)).toContain(card.code);
      expect(fromA2.body.data.items.map((c) => c.code)).not.toContain('ORGBCARD2345');

      const bee = await login(app, 'bee');
      const fromB = await call(bee, 'get', '/gift-cards', fx.b1).expect(200);
      expect(fromB.body.data.items.map((c) => c.code)).toEqual(['ORGBCARD2345']);
      await call(bee, 'get', `/gift-cards/lookup/${card.code}`, fx.b1).expect(404);
      await call(bee, 'patch', `/gift-cards/${card.id}/status`, fx.b1).send({ isActive: false }).expect(404);
      await call(admin, 'get', '/gift-cards/lookup/ORGBCARD2345').expect(404);
      await call(admin, 'patch', `/gift-cards/${orgBCard.id}/status`).send({ isActive: false }).expect(404);
    });

    it('looks up a card by code for any role', async () => {
      const typed = `${card.code.slice(0, 4).toLowerCase()}-${card.code.slice(4)}`;
      const res = await call(desk, 'get', `/gift-cards/lookup/${typed}`).expect(200);
      expect(res.body.data).toMatchObject({ code: card.code, balancePaise: 100000, initialPaise: 100000, expiresOn: card.expiresOn, isActive: true, usable: true });
      await call(desk, 'get', '/gift-cards/lookup/NOSUCHCARD22').expect(404);
    });

    it('filters by status, searches and paginates', async () => {
      await prisma.giftCard.create({ data: { organizationId: fx.orgA, code: 'USEDCARD2345', initialPaise: 1000, balancePaise: 0 } });
      await prisma.giftCard.create({ data: { organizationId: fx.orgA, code: 'OLDCARD23456', initialPaise: 1000, balancePaise: 500, expiresOn: dbDate(shiftIso(istToday(), -1)) } });

      const codes = async (query) => (await call(desk, 'get', `/gift-cards?${query}`).expect(200)).body.data.items.map((c) => c.code);
      expect(await codes('status=used')).toEqual(['USEDCARD2345']);
      expect(await codes('status=expired')).toEqual(['OLDCARD23456']);
      expect(await codes('status=active')).toHaveLength(2);
      expect(await codes('status=inactive')).toEqual([]);
      expect(await codes('q=test client')).toEqual([card.code]);
      expect(await codes('q=9200000001')).toEqual([card.code]);
      expect(await codes('q=usedcard')).toEqual(['USEDCARD2345']);

      const expiredLookup = await call(desk, 'get', '/gift-cards/lookup/OLDCARD23456').expect(200);
      expect(expiredLookup.body.data).toMatchObject({ usable: false, status: 'EXPIRED' });

      const page = await call(desk, 'get', '/gift-cards?pageSize=2&page=2').expect(200);
      expect(page.body.data).toMatchObject({ total: 4, page: 2, pageSize: 2 });
      expect(page.body.data.items).toHaveLength(2);
    });

    it('deactivates cards (managers only)', async () => {
      await call(desk, 'patch', `/gift-cards/${card.id}/status`).send({ isActive: false }).expect(403);
      const res = await call(admin, 'patch', `/gift-cards/${card.id}/status`).send({ isActive: false }).expect(200);
      expect(res.body.data).toMatchObject({ isActive: false, status: 'INACTIVE', client: { name: 'Test Client' } });
      expect((await call(desk, 'get', `/gift-cards/lookup/${card.code}`).expect(200)).body.data.usable).toBe(false);
      const inactive = await call(desk, 'get', '/gift-cards?status=inactive').expect(200);
      expect(inactive.body.data.items.map((c) => c.id)).toEqual([card.id]);
    });
  });
});
