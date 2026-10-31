import ExcelJS from 'exceljs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { buildProductTemplate, parseProductSheet, PRODUCT_IMPORT_COLUMNS } from '../src/services/productImport.js';
import { login, resetDatabase, seedBase } from './helpers.js';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

async function productSheet(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(PRODUCT_IMPORT_COLUMNS);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('product import parser', () => {
  it('parses its own template', async () => {
    const { rows, errors } = await parseProductSheet(await buildProductTemplate());
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      data: {
        name: 'Argan hair serum',
        brand: 'Moroccan Gold',
        barcode: '8901234567890',
        unit: 'ML',
        volume: 100,
        mrpPaise: 89900,
        salePricePaise: 79900,
        costPricePaise: 45000,
        rewardPoints: 0,
        lowStockAt: 5,
        isRetail: true,
        taxRateId: null,
        isActive: true,
        openingStock: 12,
      },
      provided: ['name', 'mrpPaise', 'salePricePaise', 'brand', 'barcode', 'unit', 'volume', 'costPricePaise'],
    });
  });

  it('defaults sale price to MRP, unit to pieces and opening stock to 0', async () => {
    const { rows } = await parseProductSheet(await productSheet([['Comb', '', '', '', '', '120.5', '', '', '']]));
    expect(rows[0].data).toMatchObject({ unit: 'PCS', volume: null, mrpPaise: 12050, salePricePaise: 12050, costPricePaise: 0, openingStock: 0 });
    expect(rows[0].provided).toEqual(['name', 'mrpPaise', 'salePricePaise']);
  });

  it('understands unit aliases', async () => {
    const { rows } = await parseProductSheet(
      await productSheet([
        ['A', '', '', 'Ltr', 1, 10, '', '', ''],
        ['B', '', '', 'gm', 1, 10, '', '', ''],
        ['C', '', '', 'Packet', 1, 10, '', '', ''],
      ]),
    );
    expect(rows.map((r) => r.data.unit)).toEqual(['L', 'G', 'PKT']);
  });

  it('reports bad rows with their row number and skips blank rows', async () => {
    const { rows, errors } = await parseProductSheet(
      await productSheet([
        ['Ok product', '', '', 'PCS', '', 100, 90, 50, 3],
        ['', '', '', '', '', '', '', '', ''],
        ['', 'No name', '', '', '', 100, '', '', ''],
        ['Bad price', '', '', '', '', 'abc', '', '', ''],
        ['Too dear', '', '', 'Crate', '', 100, 200, '', -1],
      ]),
    );
    expect(rows.map((r) => r.data.name)).toEqual(['Ok product']);
    expect(errors).toEqual([
      { row: 4, message: expect.stringContaining('Name') },
      { row: 5, message: expect.stringContaining('MRP') },
      { row: 6, message: expect.stringMatching(/Unit: .*Opening stock: /) },
    ]);
  });

  it('rejects files that are not workbooks', async () => {
    await expect(parseProductSheet(Buffer.from('not a spreadsheet'))).rejects.toThrow();
  });
});

// Requires TEST_DATABASE_URL pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('inventory API', () => {
  let app;
  let prisma;
  let fx;
  let admin;
  let desk;
  let boss;
  let vendorId;
  let serum; // retail product with opening stock
  let wax; // consumable

  const inA1 = (agent, method, path) => agent[method](`/api${path}`).set(BRANCH_HEADER, fx.a1);
  const stockOf = async (agent, id, branchId = fx.a1) =>
    (await agent.get(`/api/products/${id}`).set(BRANCH_HEADER, branchId).expect(200)).body.data.stockOnHand;

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    await resetDatabase(prisma);
    fx = await seedBase(prisma);
    [admin, desk, boss] = await Promise.all([login(app, 'admin'), login(app, 'desk'), login(app, 'boss')]);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  describe('products', () => {
    it('creates a product with opening stock', async () => {
      const res = await inA1(admin, 'post', '/products')
        .send({
          name: 'Argan serum', brand: 'Moroccan Gold', barcode: '8901111', unit: 'ML', volume: 100,
          mrpPaise: 89900, salePricePaise: 79900, costPricePaise: 45000, rewardPoints: 8, lowStockAt: 3, taxRateId: fx.gst18, openingStock: 10,
        })
        .expect(201);
      serum = res.body.data;
      expect(serum).toMatchObject({ name: 'Argan serum', volume: 100, stockOnHand: 10, isLow: false, isRetail: true, taxRateId: fx.gst18 });
      const opening = await prisma.stockMovement.findMany({ where: { productId: serum.id } });
      expect(opening).toMatchObject([{ reason: 'OPENING', qtyChange: 10, createdById: fx.users.admin, branchId: fx.a1 }]);

      const consumable = await inA1(admin, 'post', '/products')
        .send({ name: 'Wax cartridge', unit: 'G', mrpPaise: 30000, salePricePaise: 30000, isRetail: false })
        .expect(201);
      wax = consumable.body.data;
      expect(wax).toMatchObject({ stockOnHand: 0, isLow: true, lowStockAt: 5, costPricePaise: 0 });
      expect(await prisma.stockMovement.count({ where: { productId: wax.id } })).toBe(0);
    });

    it('validates prices, tax, duplicates and roles', async () => {
      const tooDear = await inA1(admin, 'post', '/products').send({ name: 'X', mrpPaise: 100, salePricePaise: 200 });
      expect(tooDear.status).toBe(400);
      expect(tooDear.body.error.details).toHaveProperty('salePricePaise');

      const negative = await inA1(admin, 'post', '/products').send({ name: 'X', mrpPaise: 100, salePricePaise: 100, lowStockAt: -1, openingStock: -2 });
      expect(Object.keys(negative.body.error.details)).toEqual(expect.arrayContaining(['lowStockAt', 'openingStock']));

      const otherTax = await prisma.taxRate.create({ data: { branchId: fx.a2, name: 'GST 5%', ratePct: 5, appliesTo: 'PRODUCT' } });
      const badTax = await inA1(admin, 'post', '/products').send({ name: 'X', mrpPaise: 100, salePricePaise: 100, taxRateId: otherTax.id });
      expect(badTax.status).toBe(400);
      expect(badTax.body.error.details).toEqual({ taxRateId: expect.any(String) });

      const dup = await inA1(admin, 'post', '/products').send({ name: 'Argan serum', mrpPaise: 100, salePricePaise: 100 });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ name: 'Already exists' });

      await inA1(desk, 'post', '/products').send({ name: 'Desk product', mrpPaise: 100, salePricePaise: 100 }).expect(403);
    });

    it('updates a product without touching stock, and toggles status', async () => {
      const res = await inA1(admin, 'put', `/products/${serum.id}`)
        .send({ ...serum, salePricePaise: 85000, openingStock: 99 })
        .expect(200);
      expect(res.body.data).toMatchObject({ salePricePaise: 85000, stockOnHand: 10 });

      await inA1(admin, 'patch', `/products/${wax.id}/status`).send({ isActive: false }).expect(200);
      const active = await inA1(desk, 'get', '/products').expect(200);
      expect(active.body.data.items.map((p) => p.name)).toEqual(['Argan serum']);
      const all = await inA1(desk, 'get', '/products?status=all').expect(200);
      expect(all.body.data).toMatchObject({ total: 2, page: 1, pageSize: 25 });
      await inA1(admin, 'patch', `/products/${wax.id}/status`).send({ isActive: true }).expect(200);
    });

    it('filters by search, retail and low stock', async () => {
      const byBrand = await inA1(desk, 'get', '/products?q=moroccan').expect(200);
      expect(byBrand.body.data.items.map((p) => p.name)).toEqual(['Argan serum']);
      const byBarcode = await inA1(desk, 'get', '/products?q=8901111').expect(200);
      expect(byBarcode.body.data.total).toBe(1);
      const consumables = await inA1(desk, 'get', '/products?retail=false').expect(200);
      expect(consumables.body.data.items.map((p) => p.name)).toEqual(['Wax cartridge']);
      const low = await inA1(desk, 'get', '/products?lowStock=true').expect(200);
      expect(low.body.data.items.map((p) => p.name)).toEqual(['Wax cartridge']);
    });

    it('looks up a product by barcode for any role', async () => {
      const res = await inA1(desk, 'get', '/products/lookup?barcode=8901111').expect(200);
      expect(res.body.data).toMatchObject({ id: serum.id, stockOnHand: 10 });
      await inA1(desk, 'get', '/products/lookup?barcode=nope').expect(404);
      await inA1(desk, 'get', '/products/lookup').expect(400);
    });
  });

  describe('vendors and purchases', () => {
    it('lets managers manage vendors and everyone read them', async () => {
      await inA1(desk, 'post', '/vendors').send({ name: 'Desk vendor' }).expect(403);
      const res = await inA1(admin, 'post', '/vendors').send({ name: 'Beauty Distributors', phone: '98765 43210', gstin: '27abcde1234f1z5' }).expect(201);
      vendorId = res.body.data.id;
      expect(res.body.data).toMatchObject({ phone: '9876543210', gstin: '27ABCDE1234F1Z5', purchasesTotalPaise: 0, outstandingPaise: 0 });
      const badGstin = await inA1(admin, 'post', '/vendors').send({ name: 'Other', gstin: '123' });
      expect(badGstin.body.error.details).toHaveProperty('gstin');
      const list = await inA1(desk, 'get', '/vendors').expect(200);
      expect(list.body.data.map((v) => v.name)).toEqual(['Beauty Distributors']);
    });

    it('records a purchase: totals, stock, cost price and lots', async () => {
      await inA1(desk, 'post', '/purchases').send({}).expect(403);
      const res = await inA1(admin, 'post', '/purchases')
        .send({
          vendorId,
          invoiceNo: 'INV-1',
          purchasedOn: istToday(),
          items: [
            { productId: serum.id, qty: 5, costPricePaise: 50000, mrpPaise: 95000, lotNo: 'L1', expiresOn: shiftIso(istToday(), 10) },
            { productId: wax.id, qty: 4, costPricePaise: 20000, lotNo: 'W1', expiresOn: shiftIso(istToday(), -1) },
          ],
          discountPaise: 10000,
          taxPaise: 18000,
          shippingPaise: 5000,
          paidPaise: 100000,
          // Totals sent by the client are ignored.
          subtotalPaise: 1,
          totalPaise: 1,
        })
        .expect(201);
      const purchase = res.body.data;
      expect(purchase).toMatchObject({
        subtotalPaise: 330000, // 5 × 500 + 4 × 200
        totalPaise: 343000, // − 100 + 180 + 50
        paidPaise: 100000,
        outstandingPaise: 243000,
        createdById: fx.users.admin,
        vendor: { name: 'Beauty Distributors' },
        createdBy: { name: 'admin' },
      });
      expect(purchase.items).toHaveLength(2);
      expect(purchase.items[0]).toMatchObject({ product: { name: 'Argan serum' }, qty: 5, mrpPaise: 95000, lotNo: 'L1' });
      expect(purchase.items.find((i) => i.lotNo === 'W1').mrpPaise).toBe(30000);

      expect(await stockOf(admin, serum.id)).toBe(15);
      expect(await stockOf(admin, wax.id)).toBe(4);
      const updated = await prisma.product.findUnique({ where: { id: serum.id } });
      expect(updated).toMatchObject({ costPricePaise: 50000, mrpPaise: 95000, salePricePaise: 85000 });
      const movement = await prisma.stockMovement.findFirst({ where: { productId: serum.id, reason: 'PURCHASE' } });
      expect(movement).toMatchObject({ qtyChange: 5, purchaseItemId: purchase.items[0].id });

      const vendors = await inA1(admin, 'get', '/vendors').expect(200);
      expect(vendors.body.data[0]).toMatchObject({ purchasesTotalPaise: 343000, outstandingPaise: 243000 });

      const list = await inA1(admin, 'get', `/purchases?from=${istToday()}&to=${istToday()}`).expect(200);
      expect(list.body.data).toMatchObject({ total: 1, summary: { totalPaise: 343000, outstandingPaise: 243000 } });
      const none = await inA1(admin, 'get', `/purchases?to=${shiftIso(istToday(), -1)}`).expect(200);
      expect(none.body.data.total).toBe(0);
    });

    it('validates purchases', async () => {
      const base = { vendorId, purchasedOn: istToday(), items: [{ productId: serum.id, qty: 1, costPricePaise: 1000 }] };
      const overDiscount = await inA1(admin, 'post', '/purchases').send({ ...base, discountPaise: 2000 });
      expect(overDiscount.body.error.details).toHaveProperty('discountPaise');
      const overPaid = await inA1(admin, 'post', '/purchases').send({ ...base, paidPaise: 2000 });
      expect(overPaid.body.error.details).toHaveProperty('paidPaise');
      const empty = await inA1(admin, 'post', '/purchases').send({ ...base, items: [] });
      expect(empty.body.error.details).toHaveProperty('items');
      const badQty = await inA1(admin, 'post', '/purchases').send({ ...base, items: [{ productId: serum.id, qty: 0, costPricePaise: 1 }] });
      expect(badQty.body.error.details).toHaveProperty(['items.0.qty']);
      const future = await inA1(admin, 'post', '/purchases').send({ ...base, purchasedOn: shiftIso(istToday(), 2) });
      expect(future.body.error.details).toHaveProperty('purchasedOn');

      const foreign = await prisma.product.create({ data: { branchId: fx.a2, name: 'A2 only', mrpPaise: 100, salePricePaise: 100 } });
      const wrongBranch = await inA1(admin, 'post', '/purchases').send({ ...base, items: [{ productId: foreign.id, qty: 1, costPricePaise: 1 }] });
      expect(wrongBranch.status).toBe(400);
      expect(wrongBranch.body.error.details).toHaveProperty(['items.0.productId']);

      await inA1(admin, 'patch', `/vendors/${vendorId}/status`).send({ isActive: false }).expect(200);
      const inactive = await inA1(admin, 'post', '/purchases').send(base);
      expect(inactive.body.error.details).toHaveProperty('vendorId');
      await inA1(admin, 'patch', `/vendors/${vendorId}/status`).send({ isActive: true }).expect(200);
      expect(await prisma.purchase.count()).toBe(1);
    });

    it('records payments up to the amount due', async () => {
      const [purchase] = (await inA1(admin, 'get', '/purchases').expect(200)).body.data.items;
      const res = await inA1(admin, 'post', `/purchases/${purchase.id}/payments`).send({ amountPaise: 43000 }).expect(200);
      expect(res.body.data).toMatchObject({ paidPaise: 143000, outstandingPaise: 200000 });
      const over = await inA1(admin, 'post', `/purchases/${purchase.id}/payments`).send({ amountPaise: 200001 });
      expect(over.status).toBe(400);
      expect(over.body.error.details).toHaveProperty('amountPaise');
      await inA1(admin, 'post', `/purchases/${purchase.id}/payments`).send({ amountPaise: 0 }).expect(400);

      const vendors = await inA1(admin, 'get', '/vendors').expect(200);
      expect(vendors.body.data[0].outstandingPaise).toBe(200000);
      // Another branch cannot see or pay it.
      await boss.post(`/api/purchases/${purchase.id}/payments`).set(BRANCH_HEADER, fx.a2).send({ amountPaise: 1 }).expect(404);
    });
  });

  describe('stock movements', () => {
    it('records usage by any role, never beyond stock', async () => {
      const res = await inA1(desk, 'post', '/stock/usage').send({ productId: serum.id, qty: 2, staffId: fx.stylist, note: 'Hair spa' }).expect(201);
      expect(res.body.data).toMatchObject({ reason: 'USAGE', qtyChange: -2, staffId: fx.stylist, stockOnHand: 13 });

      const tooMuch = await inA1(desk, 'post', '/stock/usage').send({ productId: serum.id, qty: 14 });
      expect(tooMuch.status).toBe(400);
      expect(tooMuch.body.error.details).toEqual({ qty: 'Only 13 in stock' });

      const otherStaff = await prisma.staff.create({
        data: { branchId: fx.a2, kind: 'STAFF', name: 'A2 staff', phone: '9100000099', gender: 'MALE', joinedOn: new Date('2026-01-01') },
      });
      const badStaff = await inA1(desk, 'post', '/stock/usage').send({ productId: serum.id, qty: 1, staffId: otherStaff.id });
      expect(badStaff.body.error.details).toHaveProperty('staffId');
    });

    it('lets only managers adjust, never below zero', async () => {
      await inA1(desk, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: -1, note: 'Broken' }).expect(403);
      const noNote = await inA1(admin, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: -1 });
      expect(noNote.body.error.details).toHaveProperty('note');
      const zero = await inA1(admin, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: 0, note: 'x' });
      expect(zero.body.error.details).toHaveProperty('qtyChange');
      const tooMuch = await inA1(admin, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: -14, note: 'Count' });
      expect(tooMuch.body.error.details).toEqual({ qtyChange: 'Only 13 in stock' });

      const res = await inA1(admin, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: -1, note: 'Broken bottle' }).expect(201);
      expect(res.body.data).toMatchObject({ reason: 'ADJUSTMENT', qtyChange: -1, stockOnHand: 12 });
      await inA1(admin, 'post', '/stock/adjustments').send({ productId: serum.id, qtyChange: 3, note: 'Found in store' }).expect(201);
      expect(await stockOf(admin, serum.id)).toBe(15);
    });

    it('lets billing sales take stock negative and still blocks usage', async () => {
      await prisma.stockMovement.create({ data: { branchId: fx.a1, productId: wax.id, qtyChange: -6, reason: 'SALE' } });
      expect(await stockOf(admin, wax.id)).toBe(-2);
      const usage = await inA1(desk, 'post', '/stock/usage').send({ productId: wax.id, qty: 1 });
      expect(usage.body.error.details).toEqual({ qty: 'Only 0 in stock' });
      await inA1(admin, 'post', '/stock/adjustments').send({ productId: wax.id, qtyChange: 3, note: 'Recount' }).expect(201);
      expect(await stockOf(admin, wax.id)).toBe(1);
    });

    it('shows the movement ledger newest first with names and balances', async () => {
      const res = await inA1(desk, 'get', `/products/${serum.id}/movements?pageSize=3`).expect(200);
      expect(res.body.data).toMatchObject({ total: 5, page: 1, pageSize: 3 });
      expect(res.body.data.items.map((m) => [m.reason, m.qtyChange, m.balanceAfter])).toEqual([
        ['ADJUSTMENT', 3, 15],
        ['ADJUSTMENT', -1, 12],
        ['USAGE', -2, 13],
      ]);
      expect(res.body.data.items[2]).toMatchObject({ note: 'Hair spa', staff: { name: 'Stylist One' }, createdBy: { name: 'desk' } });
      const page2 = await inA1(desk, 'get', `/products/${serum.id}/movements?pageSize=3&page=2`).expect(200);
      expect(page2.body.data.items.map((m) => [m.reason, m.qtyChange, m.balanceAfter])).toEqual([
        ['PURCHASE', 5, 15],
        ['OPENING', 10, 10],
      ]);
      expect(page2.body.data.items[0]).toMatchObject({ note: 'Invoice INV-1', staff: null, createdBy: { name: 'admin' } });
    });

    it('reports low stock and expiring lots', async () => {
      await inA1(admin, 'put', `/products/${wax.id}`).send({ ...wax, lowStockAt: 1 }).expect(200);
      const res = await inA1(desk, 'get', '/stock/alerts').expect(200);
      expect(res.body.data.lowStock.map((p) => [p.name, p.stockOnHand])).toEqual([['Wax cartridge', 1]]);
      expect(res.body.data.expiring.map((l) => [l.productName, l.lotNo, l.expired])).toEqual([
        ['Wax cartridge', 'W1', true],
        ['Argan serum', 'L1', false],
      ]);
      expect(res.body.data.expiring[1]).toMatchObject({ qty: 5, expiresOn: shiftIso(istToday(), 10) });

      // Lots of products that are out of stock are not worth an alert.
      await inA1(admin, 'post', '/stock/adjustments').send({ productId: wax.id, qtyChange: -1, note: 'Used up' }).expect(201);
      const after = await inA1(desk, 'get', '/stock/alerts').expect(200);
      expect(after.body.data.expiring.map((l) => l.lotNo)).toEqual(['L1']);
    });
  });

  describe('transfers', () => {
    it('only lets managers with access to both branches transfer', async () => {
      await inA1(desk, 'post', '/stock/transfers').send({ toBranchId: fx.a2, items: [{ productId: serum.id, qty: 1 }] }).expect(403);
      // admin is assigned to A1 only
      await inA1(admin, 'post', '/stock/transfers').send({ toBranchId: fx.a2, items: [{ productId: serum.id, qty: 1 }] }).expect(403);
      const otherOrg = await inA1(boss, 'post', '/stock/transfers').send({ toBranchId: fx.b1, items: [{ productId: serum.id, qty: 1 }] });
      expect(otherOrg.status).toBe(400);
      expect(otherOrg.body.error.details).toHaveProperty('toBranchId');
      const same = await inA1(boss, 'post', '/stock/transfers').send({ toBranchId: fx.a1, items: [{ productId: serum.id, qty: 1 }] });
      expect(same.body.error.details).toHaveProperty('toBranchId');
      const tooMuch = await inA1(boss, 'post', '/stock/transfers').send({ toBranchId: fx.a2, items: [{ productId: serum.id, qty: 16 }] });
      expect(tooMuch.body.error.details).toEqual({ 'items.0.qty': 'Only 15 in stock' });
      expect(await prisma.stockMovement.count({ where: { transferId: { not: null } } })).toBe(0);
    });

    it('moves stock and creates the product in the receiving branch', async () => {
      const res = await inA1(boss, 'post', '/stock/transfers').send({ toBranchId: fx.a2, items: [{ productId: serum.id, qty: 4 }], note: 'Weekend rush' }).expect(201);
      const { transferId, items } = res.body.data;
      expect(items).toHaveLength(1);
      const movements = await prisma.stockMovement.findMany({ where: { transferId }, orderBy: { qtyChange: 'asc' } });
      expect(movements).toMatchObject([
        { branchId: fx.a1, productId: serum.id, qtyChange: -4, reason: 'TRANSFER_OUT', note: 'Weekend rush' },
        { branchId: fx.a2, productId: items[0].targetProductId, qtyChange: 4, reason: 'TRANSFER_IN' },
      ]);
      const copy = await prisma.product.findUnique({ where: { id: items[0].targetProductId } });
      expect(copy).toMatchObject({ branchId: fx.a2, name: 'Argan serum', barcode: '8901111', mrpPaise: 95000, salePricePaise: 85000, costPricePaise: 50000, taxRateId: null });
      expect(await stockOf(boss, serum.id)).toBe(11);
      expect(await stockOf(boss, copy.id, fx.a2)).toBe(4);

      // A second transfer reuses the product already in A2.
      await inA1(boss, 'post', '/stock/transfers').send({ toBranchId: fx.a2, items: [{ productId: serum.id, qty: 1 }] }).expect(201);
      expect(await prisma.product.count({ where: { branchId: fx.a2, name: 'Argan serum' } })).toBe(1);
      expect(await stockOf(boss, copy.id, fx.a2)).toBe(5);
    });
  });

  describe('branch isolation', () => {
    it('keeps products, vendors and stock per branch', async () => {
      const a2 = await boss.get('/api/products').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(a2.body.data.items.map((p) => p.name)).toEqual(['A2 only', 'Argan serum']);
      expect(a2.body.data.items.find((p) => p.name === 'Argan serum').id).not.toBe(serum.id);
      await boss.get(`/api/products/${serum.id}`).set(BRANCH_HEADER, fx.a2).expect(404);
      await boss.get(`/api/products/${serum.id}/movements`).set(BRANCH_HEADER, fx.a2).expect(404);
      await boss.post('/api/stock/usage').set(BRANCH_HEADER, fx.a2).send({ productId: serum.id, qty: 1 }).expect(404);
      await boss.put(`/api/products/${serum.id}`).set(BRANCH_HEADER, fx.a2).send({ ...serum }).expect(404);
      expect((await boss.get('/api/vendors').set(BRANCH_HEADER, fx.a2).expect(200)).body.data).toEqual([]);
      expect((await boss.get('/api/purchases').set(BRANCH_HEADER, fx.a2).expect(200)).body.data.total).toBe(0);
      await desk.get('/api/products').set(BRANCH_HEADER, fx.a2).expect(403);
      const lookup = await boss.get('/api/products/lookup?barcode=8901111').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(lookup.body.data).toMatchObject({ branchId: fx.a2, stockOnHand: 5 });
    });
  });

  describe('excel import', () => {
    it('upserts products by name and adds opening stock only for new ones', async () => {
      const file = await productSheet([
        ['argan SERUM', 'New brand', '', '', '', 990, '', '', 50],
        ['Shampoo 1L', 'Loreal', '890222', 'L', 1, 1200, 1100, 700, 6],
        ['Broken', '', '', '', '', 'abc', '', '', ''],
      ]);
      await inA1(desk, 'post', '/products/import').attach('file', file, 'products.xlsx').expect(403);
      const res = await inA1(admin, 'post', '/products/import').attach('file', file, 'products.xlsx').expect(200);
      expect(res.body.data).toEqual({ created: 1, updated: 1, errors: [{ row: 4, message: expect.stringContaining('MRP') }] });

      const serumNow = await prisma.product.findUnique({ where: { id: serum.id } });
      // Blank cells keep existing values; the name keeps its original spelling.
      expect(serumNow).toMatchObject({ name: 'Argan serum', brand: 'New brand', barcode: '8901111', unit: 'ML', mrpPaise: 99000, salePricePaise: 99000, costPricePaise: 50000 });
      expect(await stockOf(admin, serum.id)).toBe(10);

      const shampoo = await prisma.product.findFirst({ where: { branchId: fx.a1, name: 'Shampoo 1L' } });
      expect(shampoo).toMatchObject({ unit: 'L', mrpPaise: 120000, salePricePaise: 110000, costPricePaise: 70000 });
      expect(await stockOf(admin, shampoo.id)).toBe(6);

      const template = await inA1(admin, 'get', '/products/import-template').expect(200);
      expect(template.headers['content-type']).toContain('spreadsheetml');
      const bad = await inA1(admin, 'post', '/products/import').attach('file', Buffer.from('nope'), 'x.xlsx');
      expect(bad.status).toBe(400);
    });
  });
});
