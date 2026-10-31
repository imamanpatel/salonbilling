import { Router } from 'express';
import multer from 'multer';
import { ROLES, statusSchema } from '@salon/shared';
import { productSchema } from '@salon/shared/inventory';
import { prisma } from '../../db.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { findInBranch, pageParams, queryString, statusWhere } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { buildProductTemplate, parseProductSheet } from '../../services/productImport.js';
import { stockOnHand, withStock } from '../../services/stock.js';

export const mount = { path: '/products', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });

async function assertTax(taxRateId, branchId) {
  if (!taxRateId) return;
  const exists = await prisma.taxRate.count({ where: { id: taxRateId, branchId, isActive: true } });
  if (!exists) throw badRequest('Pick a valid tax', { taxRateId: 'Pick an active tax rate' });
}

async function productWithStock(id, branchId) {
  const product = await findInBranch(prisma.product, id, branchId, 'Product');
  return (await withStock(prisma, branchId, [product]))[0];
}

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const q = queryString(req, 'q');
  const retail = queryString(req, 'retail');
  const where = { branchId: req.branchId, ...statusWhere(req) };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { brand: { contains: q, mode: 'insensitive' } },
      { barcode: { contains: q, mode: 'insensitive' } },
    ];
  }
  if (retail === 'true' || retail === 'false') where.isRetail = retail === 'true';

  // Stock is derived from movements, so the low-stock filter is applied in memory before paging.
  if (queryString(req, 'lowStock') === 'true') {
    const candidates = await prisma.product.findMany({ where, select: { id: true, lowStockAt: true } });
    const stock = await stockOnHand(prisma, req.branchId, candidates.map((p) => p.id));
    where.id = { in: candidates.filter((p) => (stock.get(p.id) ?? 0) <= p.lowStockAt).map((p) => p.id) };
  }

  const [rows, total] = await prisma.$transaction([
    prisma.product.findMany({ where, orderBy: [{ name: 'asc' }, { id: 'asc' }], skip, take }),
    prisma.product.count({ where }),
  ]);
  res.json({ data: { items: await withStock(prisma, req.branchId, rows), total, page, pageSize } });
});

// Barcode scan at the POS: any role.
router.get('/lookup', async (req, res) => {
  const barcode = queryString(req, 'barcode');
  if (!barcode) throw badRequest('Enter a barcode', { barcode: 'Enter a barcode' });
  const product = await prisma.product.findFirst({
    where: { branchId: req.branchId, barcode, isActive: true },
    orderBy: { createdAt: 'asc' },
  });
  if (!product) throw notFound('Product');
  res.json({ data: (await withStock(prisma, req.branchId, [product]))[0] });
});

router.get('/import-template', async (req, res) => {
  res.attachment('products-import-template.xlsx').send(await buildProductTemplate());
});

router.post('/import', canWrite, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an .xlsx file to upload');
  let parsed;
  try {
    parsed = await parseProductSheet(req.file.buffer);
  } catch {
    throw badRequest('Could not read the file. Upload an .xlsx file based on the sample template.');
  }

  const { rows, errors } = parsed;
  let created = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const { data, provided } of rows) {
        const { openingStock, ...fields } = data;
        const existing = await tx.product.findFirst({
          where: { branchId: req.branchId, name: { equals: fields.name, mode: 'insensitive' } },
        });
        if (existing) {
          // Blank cells keep what is on file; opening stock only applies to new products.
          const changes = Object.fromEntries(provided.filter((key) => key !== 'name').map((key) => [key, fields[key]]));
          await tx.product.update({ where: { id: existing.id }, data: changes });
          updated += 1;
        } else {
          const product = await tx.product.create({ data: { ...fields, branchId: req.branchId } });
          if (openingStock > 0) {
            await tx.stockMovement.create({
              data: { branchId: req.branchId, productId: product.id, qtyChange: openingStock, reason: 'OPENING', createdById: req.user.id },
            });
          }
          created += 1;
        }
      }
    },
    { timeout: 60_000 },
  );
  res.json({ data: { created, updated, errors } });
});

router.get('/:id', async (req, res) => {
  res.json({ data: await productWithStock(req.params.id, req.branchId) });
});

/** Stock ledger, newest first, with the running balance after each movement. */
router.get('/:id/movements', async (req, res) => {
  const product = await productWithStock(req.params.id, req.branchId);
  const { page, pageSize, skip, take } = pageParams(req);
  const where = { branchId: req.branchId, productId: product.id };
  const orderBy = [{ createdAt: 'desc' }, { id: 'desc' }];

  const [rows, total, newer] = await prisma.$transaction([
    prisma.stockMovement.findMany({ where, orderBy, skip, take }),
    prisma.stockMovement.count({ where }),
    prisma.stockMovement.findMany({ where, orderBy, take: skip, select: { qtyChange: true } }),
  ]);

  const staffIds = [...new Set(rows.map((r) => r.staffId).filter(Boolean))];
  const userIds = [...new Set(rows.map((r) => r.createdById).filter(Boolean))];
  const [staff, users] = await Promise.all([
    prisma.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } }),
  ]);
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const usersById = new Map(users.map((u) => [u.id, u]));

  let balance = product.stockOnHand - newer.reduce((sum, m) => sum + m.qtyChange, 0);
  const items = rows.map((m) => {
    const item = {
      id: m.id,
      createdAt: m.createdAt,
      reason: m.reason,
      qtyChange: m.qtyChange,
      balanceAfter: balance,
      note: m.note,
      staff: staffById.get(m.staffId) ?? null,
      createdBy: usersById.get(m.createdById) ?? null,
      transferId: m.transferId,
      purchaseItemId: m.purchaseItemId,
      billItemId: m.billItemId,
    };
    balance -= m.qtyChange;
    return item;
  });
  res.json({ data: { items, total, page, pageSize } });
});

router.post('/', canWrite, validateBody(productSchema), async (req, res) => {
  const { openingStock, ...fields } = req.body;
  await assertTax(fields.taxRateId, req.branchId);
  const product = await prisma.$transaction(async (tx) => {
    const row = await tx.product.create({ data: { ...fields, branchId: req.branchId } });
    if (openingStock > 0) {
      await tx.stockMovement.create({
        data: { branchId: req.branchId, productId: row.id, qtyChange: openingStock, reason: 'OPENING', createdById: req.user.id },
      });
    }
    return row;
  });
  res.status(201).json({ data: (await withStock(prisma, req.branchId, [product]))[0] });
});

router.put('/:id', canWrite, validateBody(productSchema), async (req, res) => {
  await findInBranch(prisma.product, req.params.id, req.branchId, 'Product');
  // eslint-disable-next-line no-unused-vars
  const { openingStock, ...fields } = req.body;
  await assertTax(fields.taxRateId, req.branchId);
  const product = await prisma.product.update({ where: { id: req.params.id }, data: fields });
  res.json({ data: (await withStock(prisma, req.branchId, [product]))[0] });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.product, req.params.id, req.branchId, 'Product');
  const product = await prisma.product.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
  res.json({ data: (await withStock(prisma, req.branchId, [product]))[0] });
});

export default router;
