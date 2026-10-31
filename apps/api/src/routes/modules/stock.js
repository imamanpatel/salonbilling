import crypto from 'node:crypto';
import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { stockAdjustmentSchema, stockTransferSchema, stockUsageSchema } from '@salon/shared/inventory';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { todayIso } from '../../lib/dates.js';
import { badRequest, forbidden } from '../../lib/errors.js';
import { findInBranch } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { assertInStock, expiringLots, lockProducts, lowStockProducts, stockOnHand } from '../../services/stock.js';

export const mount = { path: '/stock', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

// Fields copied when a transfer creates the product in the receiving branch.
const COPIED_FIELDS = ['name', 'brand', 'barcode', 'unit', 'volume', 'mrpPaise', 'salePricePaise', 'costPricePaise', 'rewardPoints', 'lowStockAt', 'isRetail'];

const movementDto = (movement, stock) => ({ ...movement, stockOnHand: stock });

router.get('/alerts', async (req, res) => {
  const [lowStock, expiring] = await Promise.all([
    lowStockProducts(prisma, req.branchId),
    expiringLots(prisma, req.branchId, todayIso(config.timezone)),
  ]);
  res.json({ data: { lowStock, expiring } });
});

// "Use product in salon": any role.
router.post('/usage', validateBody(stockUsageSchema), async (req, res) => {
  const { productId, qty, staffId, note } = req.body;
  await findInBranch(prisma.product, productId, req.branchId, 'Product');
  if (staffId && !(await prisma.staff.count({ where: { id: staffId, branchId: req.branchId } }))) {
    throw badRequest('Pick a valid staff member', { staffId: 'Pick a staff member of this branch' });
  }
  const movement = await prisma.$transaction(async (tx) => {
    await lockProducts(tx, [productId]);
    await assertInStock(tx, req.branchId, [{ productId, qty, field: 'qty' }]);
    return tx.stockMovement.create({
      data: { branchId: req.branchId, productId, qtyChange: -qty, reason: 'USAGE', staffId, note, createdById: req.user.id },
    });
  });
  const stock = await stockOnHand(prisma, req.branchId, [productId]);
  res.status(201).json({ data: movementDto(movement, stock.get(productId) ?? 0) });
});

router.post('/adjustments', canWrite, validateBody(stockAdjustmentSchema), async (req, res) => {
  const { productId, qtyChange, note } = req.body;
  await findInBranch(prisma.product, productId, req.branchId, 'Product');
  const movement = await prisma.$transaction(async (tx) => {
    await lockProducts(tx, [productId]);
    if (qtyChange < 0) await assertInStock(tx, req.branchId, [{ productId, qty: -qtyChange, field: 'qtyChange' }]);
    return tx.stockMovement.create({
      data: { branchId: req.branchId, productId, qtyChange, reason: 'ADJUSTMENT', note, createdById: req.user.id },
    });
  });
  const stock = await stockOnHand(prisma, req.branchId, [productId]);
  res.status(201).json({ data: movementDto(movement, stock.get(productId) ?? 0) });
});

/** Move stock to another branch of the organisation the user can access. */
router.post('/transfers', canWrite, validateBody(stockTransferSchema), async (req, res) => {
  const { toBranchId, items, note } = req.body;
  if (toBranchId === req.branchId) throw badRequest('Pick a different branch', { toBranchId: 'Pick a branch other than this one' });
  const target = await prisma.branch.findFirst({ where: { id: toBranchId, organizationId: req.branch.organizationId, isActive: true } });
  if (!target) throw badRequest('Pick a valid branch', { toBranchId: 'Pick an active branch of your organisation' });
  if (req.user.role !== ROLES.SUPERADMIN && !req.user.branches.some((b) => b.branchId === toBranchId)) {
    throw forbidden('You do not have access to the receiving branch');
  }

  const products = await prisma.product.findMany({ where: { branchId: req.branchId, id: { in: items.map((i) => i.productId) } } });
  const productsById = new Map(products.map((p) => [p.id, p]));
  const missing = {};
  items.forEach((item, index) => {
    if (!productsById.has(item.productId)) missing[`items.${index}.productId`] = 'Pick a product of this branch';
  });
  if (Object.keys(missing).length) throw badRequest('Some products were not found', missing);

  const transferId = crypto.randomUUID();
  const moved = await prisma.$transaction(
    async (tx) => {
      await lockProducts(tx, items.map((i) => i.productId));
      await assertInStock(
        tx,
        req.branchId,
        items.map((item, index) => ({ productId: item.productId, qty: item.qty, field: `items.${index}.qty` })),
      );
      const targetTaxes = await tx.taxRate.findMany({ where: { branchId: toBranchId, isActive: true } });
      const sourceTaxIds = products.map((p) => p.taxRateId).filter(Boolean);
      const sourceTaxes = await tx.taxRate.findMany({ where: { id: { in: sourceTaxIds } } });
      const taxNames = new Map(sourceTaxes.map((t) => [t.id, t.name]));

      const result = [];
      for (const item of items) {
        const source = productsById.get(item.productId);
        let targetProduct = await tx.product.findFirst({
          where: { branchId: toBranchId, name: { equals: source.name, mode: 'insensitive' } },
        });
        if (!targetProduct) {
          // Tax rates belong to a branch: reuse the receiving branch's active rate with the same name, if any.
          const taxName = taxNames.get(source.taxRateId);
          const data = Object.fromEntries(COPIED_FIELDS.map((key) => [key, source[key]]));
          targetProduct = await tx.product.create({
            data: { ...data, branchId: toBranchId, taxRateId: targetTaxes.find((t) => t.name === taxName)?.id ?? null },
          });
        }
        const shared = { transferId, note: note ?? `Transfer to ${target.name}`, createdById: req.user.id };
        await tx.stockMovement.create({
          data: { ...shared, branchId: req.branchId, productId: source.id, qtyChange: -item.qty, reason: 'TRANSFER_OUT' },
        });
        await tx.stockMovement.create({
          data: {
            ...shared,
            branchId: toBranchId,
            productId: targetProduct.id,
            qtyChange: item.qty,
            reason: 'TRANSFER_IN',
            note: note ?? `Transfer from ${req.branch.name}`,
          },
        });
        result.push({ productId: source.id, name: source.name, qty: item.qty, targetProductId: targetProduct.id });
      }
      return result;
    },
    { timeout: 60_000 },
  );
  res.status(201).json({ data: { transferId, toBranch: { id: target.id, name: target.name }, items: moved } });
});

export default router;
