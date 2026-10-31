import { Router } from 'express';
import { formatINR, ROLES } from '@salon/shared';
import { purchasePaymentSchema, purchaseSchema, purchaseTotals } from '@salon/shared/inventory';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { findInBranch, pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const mount = { path: '/purchases', scope: 'branch' };

// Stock purchases from vendors: managers only.
const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const vendorSelect = { select: { id: true, name: true } };

const purchaseDto = (purchase) => ({
  ...purchase,
  purchasedOn: toIsoDate(purchase.purchasedOn),
  outstandingPaise: purchase.totalPaise - purchase.paidPaise,
  ...(purchase.items && {
    items: purchase.items.map((item) => ({ ...item, expiresOn: toIsoDate(item.expiresOn) })),
  }),
});

async function loadPurchase(id, branchId) {
  await findInBranch(prisma.purchase, id, branchId, 'Purchase');
  const purchase = await prisma.purchase.findUnique({
    where: { id },
    include: {
      vendor: vendorSelect,
      items: {
        include: { product: { select: { id: true, name: true, brand: true, unit: true, volume: true } } },
        orderBy: [{ product: { name: 'asc' } }, { expiresOn: 'asc' }, { id: 'asc' }],
      },
    },
  });
  const createdBy = purchase.createdById
    ? await prisma.user.findUnique({ where: { id: purchase.createdById }, select: { id: true, name: true } })
    : null;
  return { ...purchaseDto(purchase), createdBy };
}

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const from = queryString(req, 'from');
  const to = queryString(req, 'to');
  const vendorId = queryString(req, 'vendorId');
  const where = { branchId: req.branchId };
  if (ISO_DATE.test(from) || ISO_DATE.test(to)) {
    where.purchasedOn = {};
    if (ISO_DATE.test(from)) where.purchasedOn.gte = fromIsoDate(from);
    if (ISO_DATE.test(to)) where.purchasedOn.lte = fromIsoDate(to);
  }
  if (vendorId) where.vendorId = vendorId;

  const [rows, total, sums] = await prisma.$transaction([
    prisma.purchase.findMany({
      where,
      include: { vendor: vendorSelect, _count: { select: { items: true } } },
      orderBy: [{ purchasedOn: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.purchase.count({ where }),
    prisma.purchase.aggregate({ where, _sum: { totalPaise: true, paidPaise: true } }),
  ]);
  const totalPaise = sums._sum.totalPaise ?? 0;
  const paidPaise = sums._sum.paidPaise ?? 0;
  res.json({
    data: {
      items: rows.map(purchaseDto),
      total,
      page,
      pageSize,
      summary: { totalPaise, paidPaise, outstandingPaise: totalPaise - paidPaise },
    },
  });
});

router.get('/:id', async (req, res) => {
  res.json({ data: await loadPurchase(req.params.id, req.branchId) });
});

router.post('/', validateBody(purchaseSchema), async (req, res) => {
  const { items, ...body } = req.body;
  const branchId = req.branchId;

  const vendor = await prisma.vendor.findFirst({ where: { id: body.vendorId, branchId, isActive: true } });
  if (!vendor) throw badRequest('Pick a valid vendor', { vendorId: 'Pick an active vendor' });
  if (body.purchasedOn > todayIso(config.timezone)) {
    throw badRequest('Purchase date cannot be in the future', { purchasedOn: 'Cannot be in the future' });
  }
  const products = await prisma.product.findMany({ where: { branchId, id: { in: items.map((i) => i.productId) } } });
  const productsById = new Map(products.map((p) => [p.id, p]));
  const missing = {};
  items.forEach((item, index) => {
    if (!productsById.has(item.productId)) missing[`items.${index}.productId`] = 'Pick a product of this branch';
  });
  if (Object.keys(missing).length) throw badRequest('Some products were not found', missing);

  const { subtotalPaise, totalPaise } = purchaseTotals(req.body);
  const purchase = await prisma.$transaction(
    async (tx) => {
      const row = await tx.purchase.create({
        data: { ...body, branchId, purchasedOn: fromIsoDate(body.purchasedOn), subtotalPaise, totalPaise, createdById: req.user.id },
      });
      // The latest purchase sets each product's cost price (and MRP when given); sale price is capped at the new MRP.
      const latest = new Map();
      for (const item of items) {
        const product = productsById.get(item.productId);
        const mrpPaise = item.mrpPaise ?? latest.get(item.productId)?.mrpPaise ?? product.mrpPaise;
        const purchaseItem = await tx.purchaseItem.create({
          data: {
            purchaseId: row.id,
            productId: item.productId,
            qty: item.qty,
            costPricePaise: item.costPricePaise,
            mrpPaise,
            lotNo: item.lotNo,
            expiresOn: fromIsoDate(item.expiresOn),
          },
        });
        await tx.stockMovement.create({
          data: {
            branchId,
            productId: item.productId,
            qtyChange: item.qty,
            reason: 'PURCHASE',
            purchaseItemId: purchaseItem.id,
            note: body.invoiceNo ? `Invoice ${body.invoiceNo}` : null,
            createdById: req.user.id,
          },
        });
        latest.set(item.productId, { costPricePaise: item.costPricePaise, mrpPaise });
      }
      for (const [productId, { costPricePaise, mrpPaise }] of latest) {
        const product = productsById.get(productId);
        await tx.product.update({
          where: { id: productId },
          data: { costPricePaise, mrpPaise, salePricePaise: Math.min(product.salePricePaise, mrpPaise) },
        });
      }
      return row;
    },
    { timeout: 60_000 },
  );
  res.status(201).json({ data: await loadPurchase(purchase.id, branchId) });
});

router.post('/:id/payments', validateBody(purchasePaymentSchema), async (req, res) => {
  const purchase = await findInBranch(prisma.purchase, req.params.id, req.branchId, 'Purchase');
  const outstanding = purchase.totalPaise - purchase.paidPaise;
  if (req.body.amountPaise > outstanding) {
    throw badRequest('Payment is more than the amount due', {
      amountPaise: outstanding > 0 ? `Only ${formatINR(outstanding)} is due` : 'Nothing is due on this purchase',
    });
  }
  // Guard against a concurrent payment changing paidPaise since it was read.
  const { count } = await prisma.purchase.updateMany({
    where: { id: purchase.id, paidPaise: purchase.paidPaise },
    data: { paidPaise: { increment: req.body.amountPaise } },
  });
  if (!count) throw conflict('This purchase was just updated. Please try again.');
  res.json({ data: await loadPurchase(purchase.id, req.branchId) });
});

export default router;
