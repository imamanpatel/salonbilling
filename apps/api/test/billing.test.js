import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { login, resetDatabase, seedBase } from './helpers.js';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const day = (iso) => new Date(`${iso}T00:00:00.000Z`);

describe.skipIf(!process.env.TEST_DATABASE_URL)('Billing (M4)', () => {
  let app;
  let prisma;
  let fx;
  let desk;
  let admin;
  let boss;
  let phoneSeq = 0;
  const today = istToday();

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    desk = await login(app, 'desk');
    admin = await login(app, 'admin');
    boss = await login(app, 'boss');

    fx.shampoo = (await prisma.product.create({
      data: { branchId: fx.a1, name: 'Shampoo', mrpPaise: 90000, salePricePaise: 80000, rewardPoints: 5 },
    })).id;
    fx.hairPack = (await prisma.package.create({
      data: { branchId: fx.a1, name: 'Hair care', pricePaise: 120000, validityDays: 90, items: { create: [{ serviceId: fx.haircut, qty: 3 }] } },
    })).id;
    fx.gold = (await prisma.membershipPlan.create({
      data: {
        branchId: fx.a1, name: 'Gold', pricePaise: 100000, durationDays: 365, useMemberPrices: true, productDiscountPct: 10,
        packageDiscountPct: 5, pointsMultiplier: 2, rewardPoints: 100,
      },
    })).id;
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function newClient(name = 'Client') {
    phoneSeq += 1;
    return prisma.client.create({
      data: {
        organizationId: fx.orgA, homeBranchId: fx.a1, name: `${name} ${phoneSeq}`, phone: `93000${String(phoneSeq).padStart(5, '0')}`,
        gender: 'FEMALE', referralCode: `BILL${String(phoneSeq).padStart(4, '0')}`,
      },
    });
  }

  const createBill = (agent, body, branchId = fx.a1) => agent.post('/api/bills').set(BRANCH_HEADER, branchId).send(body);
  const preview = (agent, body, branchId = fx.a1) => agent.post('/api/bills/preview').set(BRANCH_HEADER, branchId).send(body);
  const haircut = (extra = {}) => ({ kind: 'SERVICE', refId: fx.haircut, staffId: fx.stylist, ...extra });
  const cash = (amountPaise) => ({ method: 'CASH', amountPaise });
  const setSettings = (data) => prisma.branchSetting.update({ where: { branchId: fx.a1 }, data });
  const wallet = async (clientId) => (await prisma.walletEntry.aggregate({ where: { clientId }, _sum: { amountPaise: true } }))._sum.amountPaise ?? 0;
  const points = async (clientId) => (await prisma.pointsEntry.aggregate({ where: { clientId }, _sum: { points: true } }))._sum.points ?? 0;
  const item = (bill, name) => bill.items.find((i) => i.name === name);

  describe('creating bills', () => {
    it('creates a simple paid bill with sequential numbers, commission and points', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [haircut()], payments: [cash(50000)] });
      expect(res.status).toBe(201);
      const bill = res.body.data;
      expect(bill).toMatchObject({
        number: 'A1-000001', status: 'PAID', subtotalPaise: 50000, discountPaise: 0, taxPaise: 0, roundOffPaise: 0,
        totalPaise: 50000, paidPaise: 50000, duePaise: 0, pointsEarned: 10,
      });
      expect(bill.items[0]).toMatchObject({ kind: 'SERVICE', name: 'Haircut', qty: 1, unitPricePaise: 50000, totalPaise: 50000, commissionPaise: 5000 });
      expect(bill.items[0].staff.name).toBe('Stylist One');
      expect(bill.payments).toMatchObject([{ kind: 'BILL', method: 'CASH', amountPaise: 50000 }]);
      expect(bill.branch).toMatchObject({ salonName: 'Salon A', name: 'A1' });
      expect(await points(client.id)).toBe(10);

      const second = await createBill(desk, { clientId: client.id, items: [haircut()], payments: [cash(50000)] }).expect(201);
      expect(second.body.data.number).toBe('A1-000002');
    });

    it('adds GST per line, rounds the total to the rupee and splits CGST/SGST', async () => {
      const client = await newClient();
      const odd = await prisma.service.create({
        data: { branchId: fx.a1, categoryId: fx.category, name: 'Odd trim', durationMin: 15, pricePaise: 49999, memberPricePaise: 49999 },
      });
      const res = await createBill(desk, {
        clientId: client.id, items: [{ kind: 'SERVICE', refId: odd.id, taxRateId: fx.gst18 }], payments: [cash(59000)],
      }).expect(201);
      expect(res.body.data).toMatchObject({ subtotalPaise: 49999, taxPaise: 9000, roundOffPaise: 1, totalPaise: 59000, status: 'PAID' });
      expect(res.body.data.taxBreakdown).toEqual([{ ratePct: 18, taxablePaise: 49999, taxPaise: 9000, cgstPaise: 4500, sgstPaise: 4500 }]);

      // Branch default tax applies when the line doesn't pick one; null means "no tax".
      await setSettings({ defaultServiceTaxId: fx.gst18, roundOffBills: false });
      const taxed = await preview(desk, { clientId: client.id, items: [{ kind: 'SERVICE', refId: odd.id }] }).expect(200);
      expect(taxed.body.data).toMatchObject({ taxPaise: 9000, roundOffPaise: 0, totalPaise: 58999 });
      const untaxed = await preview(desk, { clientId: client.id, items: [{ kind: 'SERVICE', refId: odd.id, taxRateId: null }] }).expect(200);
      expect(untaxed.body.data.taxPaise).toBe(0);
      await setSettings({ defaultServiceTaxId: null, roundOffBills: true });
    });

    it('combines line, coupon, points and manual discounts and allocates them exactly', async () => {
      const client = await newClient();
      await prisma.pointsEntry.create({ data: { clientId: client.id, branchId: fx.a1, points: 100, reason: 'OPENING' } });
      await prisma.coupon.create({ data: { branchId: fx.a1, code: 'SAVE120', discountType: 'FLAT', discountPaise: 12000 } });

      const res = await createBill(desk, {
        clientId: client.id,
        items: [
          { kind: 'SERVICE', refId: fx.colour, staffId: fx.stylist2, discount: { type: 'PERCENT', value: 10 } },
          haircut(),
        ],
        couponCode: 'save120',
        redeemPoints: 50,
        manualDiscountPaise: 3000,
        payments: [{ method: 'UPI', amountPaise: 255000, reference: 'UPI-1' }],
      });
      expect(res.status).toBe(201);
      const bill = res.body.data;
      expect(bill).toMatchObject({
        subtotalPaise: 300000, couponDiscountPaise: 12000, pointsRedeemed: 50, pointsDiscountPaise: 5000, manualDiscountPaise: 3000,
        discountPaise: 45000, totalPaise: 255000, status: 'PAID', couponCode: 'SAVE120',
      });
      // Bill discount 20000 split over nets 225000 / 50000 -> 16363.6 / 3636.4 -> 16364 / 3636.
      expect(item(bill, 'Hair colour')).toMatchObject({ discountPaise: 25000 + 16364, totalPaise: 225000 - 16364 });
      expect(item(bill, 'Haircut')).toMatchObject({ discountPaise: 3636, totalPaise: 46364 });
      expect(item(bill, 'Hair colour').commissionPaise).toBe(Math.round((225000 - 16364) * 0.1));
      // 100 - 50 redeemed + (50 + 10) earned
      expect(await points(client.id)).toBe(110);
    });

    it('rejects redeeming more points than the client has or than the bill can take', async () => {
      const client = await newClient();
      await prisma.pointsEntry.create({ data: { clientId: client.id, branchId: fx.a1, points: 1000, reason: 'OPENING' } });
      const tooMany = await createBill(desk, { clientId: client.id, items: [haircut()], redeemPoints: 2000 });
      expect(tooMany.status).toBe(400);
      expect(tooMany.body.error.details.redeemPoints).toMatch(/1000 points/);
      // 1000 points = ₹1000 but the haircut is ₹500.
      const tooMuch = await createBill(desk, { clientId: client.id, items: [haircut()], redeemPoints: 1000 });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.error.details.redeemPoints).toMatch(/At most 500 points/);
    });

    it('enforces coupon validity, minimum bill and usage limits', async () => {
      await prisma.coupon.create({
        data: { branchId: fx.a1, code: 'ONCE', discountType: 'PERCENT', discountPct: 20, maxDiscountPaise: 5000, usageLimitPerClient: 1, totalUsageLimit: 2 },
      });
      await prisma.coupon.create({ data: { branchId: fx.a1, code: 'OLD', discountType: 'FLAT', discountPaise: 1000, validTo: day(shiftIso(today, -1)) } });
      await prisma.coupon.create({ data: { branchId: fx.a1, code: 'BIG', discountType: 'FLAT', discountPaise: 1000, minBillPaise: 100000 } });
      const [x, y, z] = [await newClient(), await newClient(), await newClient()];

      const first = await createBill(desk, { clientId: x.id, items: [haircut()], couponCode: 'once', payments: [cash(45000)] }).expect(201);
      expect(first.body.data.couponDiscountPaise).toBe(5000); // 20% of 50000 capped at 5000

      const again = await createBill(desk, { clientId: x.id, items: [haircut()], couponCode: 'ONCE' });
      expect(again.status).toBe(400);
      expect(again.body.error.details.couponCode).toMatch(/already used/);
      const soft = await preview(desk, { clientId: x.id, items: [haircut()], couponCode: 'ONCE' }).expect(200);
      expect(soft.body.data.errors.couponCode).toMatch(/already used/);
      expect(soft.body.data.totalPaise).toBe(50000);

      await createBill(desk, { clientId: y.id, items: [haircut()], couponCode: 'ONCE' }).expect(201);
      const full = await createBill(desk, { clientId: z.id, items: [haircut()], couponCode: 'ONCE' });
      expect(full.body.error.details.couponCode).toMatch(/fully used/);

      expect((await createBill(desk, { clientId: z.id, items: [haircut()], couponCode: 'OLD' })).body.error.details.couponCode).toMatch(/expired/);
      expect((await createBill(desk, { clientId: z.id, items: [haircut()], couponCode: 'BIG' })).body.error.details.couponCode).toMatch(/₹1,000/);
      expect((await createBill(desk, { clientId: z.id, items: [haircut()], couponCode: 'NOPE' })).body.error.details.couponCode).toMatch(/not valid/);
    });

    it('sells memberships and then applies member prices, discounts and the points multiplier', async () => {
      const client = await newClient();
      const bought = await createBill(desk, { clientId: client.id, items: [{ kind: 'MEMBERSHIP', refId: fx.gold }], payments: [cash(100000)] }).expect(201);
      expect(bought.body.data.pointsEarned).toBe(100);
      const membership = await prisma.clientMembership.findFirst({ where: { clientId: client.id } });
      expect(membership.startsOn.toISOString().slice(0, 10)).toBe(today);
      expect(membership.endsOn.toISOString().slice(0, 10)).toBe(shiftIso(today, 364));

      const res = await createBill(desk, {
        clientId: client.id,
        items: [haircut(), { kind: 'PRODUCT', refId: fx.shampoo, staffId: fx.stylist }, { kind: 'PRODUCT', refId: fx.shampoo, discount: { type: 'PERCENT', value: 15 } }],
        payments: [cash(40000 + 72000 + 68000)],
      }).expect(201);
      const lines = res.body.data.items;
      expect(lines[0]).toMatchObject({ name: 'Haircut', unitPricePaise: 40000, discountPaise: 0 });
      expect(lines[1]).toMatchObject({ unitPricePaise: 80000, discountPaise: 8000, commissionPaise: 3600 }); // member 10%; 5% commission
      expect(lines[2]).toMatchObject({ discountPaise: 12000 }); // the larger 15% wins
      // (10 + 5 + 5) × 2
      expect(res.body.data.pointsEarned).toBe(40);
      expect(await points(client.id)).toBe(140);

      const account = await desk.get(`/api/client-accounts/${client.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(account.body.data.membership).toMatchObject({ name: 'Gold', pointsMultiplier: 2, productDiscountPct: 10 });

      // A renewal starts when the current membership ends.
      await createBill(desk, { clientId: client.id, items: [{ kind: 'MEMBERSHIP', refId: fx.gold }] }).expect(201);
      const renewal = await prisma.clientMembership.findFirst({ where: { clientId: client.id }, orderBy: { startsOn: 'desc' } });
      expect(renewal.startsOn.toISOString().slice(0, 10)).toBe(shiftIso(today, 365));
    });

    it('sells a package, redeems it and blocks over-redemption', async () => {
      const client = await newClient();
      const sale = await createBill(desk, { clientId: client.id, items: [{ kind: 'PACKAGE', refId: fx.hairPack }], payments: [cash(120000)] }).expect(201);
      fx.packageBillId = sale.body.data.id;

      const account = await desk.get(`/api/client-accounts/${client.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
      const [pkg] = account.body.data.packages;
      expect(pkg).toMatchObject({ name: 'Hair care', expiresOn: shiftIso(today, 90) });
      expect(pkg.items[0]).toMatchObject({ serviceName: 'Haircut', totalQty: 3, usedQty: 0 });
      const cpiId = pkg.items[0].clientPackageItemId;

      const redeem = await createBill(desk, {
        clientId: client.id, items: [{ kind: 'SERVICE', clientPackageItemId: cpiId, staffId: fx.stylist, qty: 2, taxRateId: fx.gst18 }],
      }).expect(201);
      expect(redeem.body.data).toMatchObject({ totalPaise: 0, status: 'PAID', pointsEarned: 0 });
      expect(redeem.body.data.items[0]).toMatchObject({ unitPricePaise: 0, taxPaise: 0, commissionPaise: 0, serviceId: fx.haircut });
      expect((await prisma.clientPackageItem.findUnique({ where: { id: cpiId } })).usedQty).toBe(2);

      const over = await createBill(desk, { clientId: client.id, items: [{ kind: 'SERVICE', clientPackageItemId: cpiId, qty: 2 }] });
      expect(over.status).toBe(400);
      expect(over.body.error.details['items.0.qty']).toMatch(/Only 1 left/);

      // Another client can't redeem it.
      const other = await newClient();
      const stranger = await createBill(desk, { clientId: other.id, items: [{ kind: 'SERVICE', clientPackageItemId: cpiId }] });
      expect(stranger.status).toBe(400);

      // Voiding the sale is blocked once the package has been used.
      const blocked = await admin.post(`/api/bills/${fx.packageBillId}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Oops' });
      expect(blocked.status).toBe(409);
    });

    it('takes wallet top-ups and wallet payments, and rejects overspending', async () => {
      const client = await newClient();
      const topup = await desk.post(`/api/client-accounts/${client.id}/wallet-topups`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 100000, method: 'UPI' });
      expect(topup.status).toBe(201);
      expect(topup.body.data.walletBalancePaise).toBe(100000);
      expect(await prisma.payment.count({ where: { clientId: client.id, kind: 'WALLET_TOPUP' } })).toBe(1);

      await createBill(desk, { clientId: client.id, items: [haircut()], payments: [{ method: 'WALLET', amountPaise: 50000 }] }).expect(201);
      expect(await wallet(client.id)).toBe(50000);

      const res = await createBill(desk, {
        clientId: client.id, items: [{ kind: 'SERVICE', refId: fx.colour }], payments: [{ method: 'WALLET', amountPaise: 60000 }],
      });
      expect(res.status).toBe(400);
      expect(res.body.error.details['payments.0.amountPaise']).toMatch(/Wallet balance/);
      expect(await wallet(client.id)).toBe(50000);

      await desk.post(`/api/client-accounts/${client.id}/wallet-topups`).set(BRANCH_HEADER, fx.a1).send({ amountPaise: 100000, method: 'WALLET' }).expect(400);
    });

    it('sells gift cards and accepts them as payment', async () => {
      const buyer = await newClient();
      const sale = await createBill(desk, { clientId: buyer.id, items: [{ kind: 'GIFT_CARD', unitPricePaise: 100000, taxRateId: fx.gst18 }], payments: [cash(100000)] }).expect(201);
      expect(sale.body.data).toMatchObject({ totalPaise: 100000, taxPaise: 0 });
      const [card] = sale.body.data.giftCardsIssued;
      expect(card.code).toMatch(/^[A-Z2-9]{12}$/);
      expect(card).toMatchObject({ initialPaise: 100000, balancePaise: 100000, expiresOn: shiftIso(today, 365) });
      fx.giftSaleBillId = sale.body.data.id;

      const user = await newClient();
      const paid = await createBill(desk, {
        clientId: user.id, items: [haircut()], payments: [{ method: 'GIFT_CARD', amountPaise: 50000, reference: card.code.toLowerCase() }],
      }).expect(201);
      expect(paid.body.data.payments[0]).toMatchObject({ method: 'GIFT_CARD', reference: card.code });
      expect((await prisma.giftCard.findUnique({ where: { code: card.code } })).balancePaise).toBe(50000);

      const tooMuch = await createBill(desk, {
        clientId: user.id, items: [{ kind: 'SERVICE', refId: fx.colour }], payments: [{ method: 'GIFT_CARD', amountPaise: 60000, reference: card.code }],
      });
      expect(tooMuch.body.error.details['payments.0.amountPaise']).toMatch(/balance is only/);
      const unknown = await createBill(desk, { clientId: user.id, items: [haircut()], payments: [{ method: 'GIFT_CARD', amountPaise: 100, reference: 'NOPE' }] });
      expect(unknown.body.error.details['payments.0.reference']).toBe('Gift card not found');

      // The sale can't be voided once the card has been spent.
      await admin.post(`/api/bills/${fx.giftSaleBillId}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'x' }).expect(409);
      // Voiding the bill paid by gift card gives the balance back.
      await admin.post(`/api/bills/${paid.body.data.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Wrong client' }).expect(200);
      expect((await prisma.giftCard.findUnique({ where: { code: card.code } })).balancePaise).toBe(100000);
    });

    it('tracks partial payments and due collection', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [haircut()], payments: [cash(20000)] }).expect(201);
      const bill = res.body.data;
      expect(bill).toMatchObject({ status: 'PARTIAL', paidPaise: 20000, duePaise: 30000 });

      const account = await desk.get(`/api/client-accounts/${client.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(account.body.data.duePaise).toBe(30000);
      expect(account.body.data.recentBills[0]).toMatchObject({ number: bill.number, duePaise: 30000, branchName: 'A1' });

      const dueList = await desk.get('/api/bills?status=DUE').set(BRANCH_HEADER, fx.a1).expect(200);
      expect(dueList.body.data.items.map((b) => b.id)).toContain(bill.id);

      const over = await desk.post(`/api/bills/${bill.id}/payments`).set(BRANCH_HEADER, fx.a1).send({ method: 'CASH', amountPaise: 40000 });
      expect(over.status).toBe(400);
      expect(over.body.error.details.amountPaise).toBeTruthy();

      await desk.post(`/api/bills/${bill.id}/payments`).set(BRANCH_HEADER, fx.a1).send({ method: 'CASH', amountPaise: 10000 }).expect(201);
      const done = await desk.post(`/api/bills/${bill.id}/payments`).set(BRANCH_HEADER, fx.a1).send({ method: 'UPI', amountPaise: 20000, reference: 'T1' }).expect(201);
      expect(done.body.data).toMatchObject({ status: 'PAID', paidPaise: 50000, duePaise: 0 });
      expect(done.body.data.payments.map((p) => p.kind)).toEqual(['BILL', 'DUE_COLLECTION', 'DUE_COLLECTION']);
      await desk.post(`/api/bills/${bill.id}/payments`).set(BRANCH_HEADER, fx.a1).send({ method: 'CASH', amountPaise: 1 }).expect(400);
    });

    it('rejects overpayment', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [haircut()], payments: [cash(30000), cash(30000)] });
      expect(res.status).toBe(400);
      expect(res.body.error.details.payments).toMatch(/more than/);
      expect(await prisma.bill.count({ where: { clientId: client.id } })).toBe(0);
    });

    it('attaches appointment advances, marks the appointment billed and undoes it on void', async () => {
      const client = await newClient();
      const appointment = await prisma.appointment.create({
        data: {
          branchId: fx.a1, clientId: client.id, date: day(today), startTime: '10:00', endTime: '10:30', status: 'CHECKED_IN',
          items: { create: [{ serviceId: fx.haircut, staffId: fx.stylist, startTime: '10:00', endTime: '10:30', pricePaise: 50000 }] },
        },
      });
      const advance = await prisma.payment.create({
        data: { branchId: fx.a1, clientId: client.id, appointmentId: appointment.id, kind: 'ADVANCE', method: 'UPI', amountPaise: 20000 },
      });

      const pv = await preview(desk, { clientId: client.id, appointmentId: appointment.id, items: [haircut()] }).expect(200);
      expect(pv.body.data).toMatchObject({ advancePaise: 20000, duePaise: 30000 });

      const res = await createBill(desk, { clientId: client.id, appointmentId: appointment.id, items: [haircut()], payments: [cash(30000)] }).expect(201);
      expect(res.body.data).toMatchObject({ status: 'PAID', paidPaise: 50000, duePaise: 0, appointment: { id: appointment.id } });
      expect((await prisma.payment.findUnique({ where: { id: advance.id } })).billId).toBe(res.body.data.id);
      expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).toMatchObject({ status: 'BILLED', billId: res.body.data.id });

      const twice = await createBill(desk, { clientId: client.id, appointmentId: appointment.id, items: [haircut()] });
      expect(twice.status).toBe(400);

      await admin.post(`/api/bills/${res.body.data.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Billed twice' }).expect(200);
      expect(await prisma.appointment.findUnique({ where: { id: appointment.id } })).toMatchObject({ status: 'CHECKED_IN', billId: null });
      expect((await prisma.payment.findUnique({ where: { id: advance.id } })).billId).toBeNull();
    });

    it('records stock sales (even below zero)', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [{ kind: 'PRODUCT', refId: fx.shampoo, qty: 2 }] }).expect(201);
      const movement = await prisma.stockMovement.findFirst({ where: { billItemId: res.body.data.items[0].id } });
      expect(movement).toMatchObject({ reason: 'SALE', qtyChange: -2, productId: fx.shampoo, branchId: fx.a1 });
    });
  });

  describe('voiding', () => {
    it('reverses wallet, points, stock, gift cards, packages and memberships', async () => {
      const client = await newClient();
      await prisma.walletEntry.create({ data: { clientId: client.id, branchId: fx.a1, amountPaise: 500000, reason: 'OPENING' } });
      await prisma.pointsEntry.create({ data: { clientId: client.id, branchId: fx.a1, points: 100, reason: 'OPENING' } });
      const res = await createBill(desk, {
        clientId: client.id,
        items: [
          { kind: 'PRODUCT', refId: fx.shampoo, qty: 1 },
          { kind: 'PACKAGE', refId: fx.hairPack },
          { kind: 'GIFT_CARD', unitPricePaise: 20000 },
          { kind: 'MEMBERSHIP', refId: fx.gold },
        ],
        redeemPoints: 40,
        payments: [{ method: 'WALLET', amountPaise: 100000 }],
      }).expect(201);
      const bill = res.body.data;
      expect(bill.status).toBe('PARTIAL');
      expect(await wallet(client.id)).toBe(400000);
      const pointsBefore = await points(client.id);
      expect(pointsBefore).toBe(100 - 40 + 5 + 100);

      await desk.post(`/api/bills/${bill.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Test' }).expect(403);
      await admin.post(`/api/bills/${bill.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: '' }).expect(400);
      const voided = await admin.post(`/api/bills/${bill.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Customer changed mind' }).expect(200);
      expect(voided.body.data).toMatchObject({ status: 'VOID', voidReason: 'Customer changed mind' });
      expect(voided.body.data.voidedAt).toBeTruthy();

      expect(await wallet(client.id)).toBe(500000);
      expect(await points(client.id)).toBe(100);
      const stock = await prisma.stockMovement.aggregate({ where: { productId: fx.shampoo, billItemId: { in: bill.items.map((i) => i.id) } }, _sum: { qtyChange: true } });
      expect(stock._sum.qtyChange).toBe(0);
      expect(await prisma.clientPackage.findFirst({ where: { billId: bill.id } })).toMatchObject({ cancelledAt: expect.any(Date) });
      expect(await prisma.clientMembership.findFirst({ where: { billId: bill.id } })).toMatchObject({ cancelledAt: expect.any(Date) });
      expect(await prisma.giftCard.findFirst({ where: { issuedBillId: bill.id } })).toMatchObject({ isActive: false });

      const account = await desk.get(`/api/client-accounts/${client.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(account.body.data).toMatchObject({ duePaise: 0, membership: null, packages: [], giftCards: [] });

      await admin.post(`/api/bills/${bill.id}/void`).set(BRANCH_HEADER, fx.a1).send({ reason: 'Again' }).expect(409);
      await desk.post(`/api/bills/${bill.id}/payments`).set(BRANCH_HEADER, fx.a1).send({ method: 'CASH', amountPaise: 100 }).expect(409);
    });
  });

  describe('permissions and scoping', () => {
    it('lets only managers override prices', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [haircut({ unitPricePaise: 1000 })] });
      expect(res.status).toBe(403);
      // Sending the catalogue price is not an override.
      await createBill(desk, { clientId: client.id, items: [haircut({ unitPricePaise: 50000 })] }).expect(201);
      const ok = await createBill(admin, { clientId: client.id, items: [haircut({ unitPricePaise: 1000 })] }).expect(201);
      expect(ok.body.data.totalPaise).toBe(1000);
    });

    it('keeps bills, catalogue and clients inside their branch and organisation', async () => {
      const client = await newClient();
      const res = await createBill(desk, { clientId: client.id, items: [haircut()] }).expect(201);
      await boss.get(`/api/bills/${res.body.data.id}`).set(BRANCH_HEADER, fx.a2).expect(404);
      const list = await boss.get('/api/bills').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(list.body.data.total).toBe(0);
      await desk.get('/api/bills').set(BRANCH_HEADER, fx.a2).expect(403);

      const wrongBranch = await createBill(boss, { clientId: client.id, items: [{ kind: 'SERVICE', refId: fx.haircut }] }, fx.a2);
      expect(wrongBranch.status).toBe(400);
      expect(wrongBranch.body.error.details['items.0.refId']).toBeTruthy();

      const outsider = await prisma.client.create({
        data: { organizationId: fx.orgB, name: 'Outsider', phone: '9399999999', gender: 'MALE', referralCode: 'OUTSIDE1' },
      });
      const foreign = await createBill(desk, { clientId: outsider.id, items: [haircut()] });
      expect(foreign.body.error.details.clientId).toBeTruthy();
      await desk.get(`/api/client-accounts/${outsider.id}`).set(BRANCH_HEADER, fx.a1).expect(404);

      const otherStaff = await prisma.staff.create({
        data: { branchId: fx.a2, kind: 'SERVICE_PROVIDER', name: 'Elsewhere', phone: '9100000099', gender: 'MALE', joinedOn: day('2026-01-01') },
      });
      const badStaff = await createBill(desk, { clientId: client.id, items: [haircut({ staffId: otherStaff.id })] });
      expect(badStaff.body.error.details['items.0.staffId']).toBeTruthy();
    });

    it('lets only managers adjust points, never below zero', async () => {
      const client = await newClient();
      const url = `/api/client-accounts/${client.id}/points-adjustments`;
      await desk.post(url).set(BRANCH_HEADER, fx.a1).send({ points: 10, note: 'Gift' }).expect(403);
      const added = await admin.post(url).set(BRANCH_HEADER, fx.a1).send({ points: 25, note: 'Welcome' }).expect(201);
      expect(added.body.data.pointsBalance).toBe(25);
      const below = await admin.post(url).set(BRANCH_HEADER, fx.a1).send({ points: -30, note: 'Fix' });
      expect(below.status).toBe(400);
      expect(below.body.error.details.points).toBeTruthy();
      await admin.post(url).set(BRANCH_HEADER, fx.a1).send({ points: -25, note: 'Fix' }).expect(201);
    });
  });

  describe('preview, listing and catalogue', () => {
    it('prices a bill without writing anything', async () => {
      const client = await newClient();
      await prisma.walletEntry.create({ data: { clientId: client.id, branchId: fx.a1, amountPaise: 10000, reason: 'OPENING' } });
      const tables = ['bill', 'billItem', 'payment', 'walletEntry', 'pointsEntry', 'stockMovement', 'clientPackage', 'clientMembership', 'giftCard', 'messageLog'];
      const counts = async () => Promise.all(tables.map((t) => prisma[t].count()));
      const counter = async () => (await prisma.billCounter.findUnique({ where: { branchId: fx.a1 } }))?.next;
      const before = [await counts(), await counter()];

      const res = await preview(desk, {
        clientId: client.id,
        items: [
          haircut({ taxRateId: fx.gst18 }),
          { kind: 'PRODUCT', refId: fx.shampoo },
          { kind: 'PACKAGE', refId: fx.hairPack },
          { kind: 'GIFT_CARD', unitPricePaise: 5000 },
          { kind: 'MEMBERSHIP', refId: fx.gold },
        ],
        payments: [{ method: 'WALLET', amountPaise: 20000 }],
        sendReceipt: true,
      }).expect(200);
      expect(res.body.data).toMatchObject({ subtotalPaise: 50000 + 80000 + 120000 + 5000 + 100000, taxPaise: 9000, walletBalancePaise: 10000 });
      expect(res.body.data.lines).toHaveLength(5);
      expect(res.body.data.errors['payments.0.amountPaise']).toMatch(/Wallet balance/);
      expect([await counts(), await counter()]).toEqual(before);
    });

    it('lists bills with filters and returns print details', async () => {
      const client = await newClient('Searchable');
      const res = await createBill(desk, { clientId: client.id, items: [haircut({ taxRateId: fx.gst18 })], payments: [cash(59000)], sendReceipt: true }).expect(201);
      const bill = res.body.data;
      expect(bill.gst).toEqual({ cgstPaise: 4500, sgstPaise: 4500 });
      expect(bill.createdBy.name).toBe('desk');
      const message = await prisma.messageLog.findFirst({ where: { clientId: client.id, kind: 'BILL_RECEIPT' } });
      expect(message.body).toContain(bill.number);
      expect(message.body).toContain(bill.feedbackToken);

      const byName = await desk.get(`/api/bills?q=searchable&from=${today}&to=${today}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(byName.body.data.items.map((b) => b.id)).toEqual([bill.id]);
      expect(byName.body.data.items[0]).toMatchObject({ client: { name: client.name }, createdBy: { name: 'desk' }, totalPaise: 59000 });
      const byNumber = await desk.get(`/api/bills?q=${bill.number}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(byNumber.body.data.total).toBe(1);
      const byPhone = await desk.get(`/api/bills?q=${client.phone}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(byPhone.body.data.total).toBe(1);
      const yesterday = await desk.get(`/api/bills?from=${shiftIso(today, -1)}&to=${shiftIso(today, -1)}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(yesterday.body.data.total).toBe(0);
      const voids = await desk.get('/api/bills?status=VOID').set(BRANCH_HEADER, fx.a1).expect(200);
      expect(voids.body.data.items.every((b) => b.status === 'VOID')).toBe(true);
      await desk.get('/api/bills?from=31-10-2026').set(BRANCH_HEADER, fx.a1).expect(400);
    });

    it('serves the POS catalogue', async () => {
      await setSettings({ defaultServiceTaxId: fx.gst18 });
      const res = await desk.get('/api/bills/catalogue').set(BRANCH_HEADER, fx.a1).expect(200);
      const data = res.body.data;
      expect(data.services.map((s) => s.name)).toEqual(expect.arrayContaining(['Haircut', 'Hair colour']));
      expect(data.services[0].category.name).toBe('Hair');
      expect(data.products.map((p) => p.name)).toEqual(['Shampoo']);
      expect(data.packages[0].items[0].service.name).toBe('Haircut');
      expect(data.membershipPlans[0]).toMatchObject({ name: 'Gold', productDiscountPct: 10 });
      expect(data.taxes[0]).toMatchObject({ ratePct: 18 });
      expect(data.defaults).toEqual({ serviceTaxId: fx.gst18, productTaxId: null });
      await setSettings({ defaultServiceTaxId: null });
    });
  });
});
