import { Router } from 'express';
import { ROLES, statusSchema } from '@salon/shared';
import { vendorSchema } from '@salon/shared/inventory';
import { prisma } from '../../db.js';
import { findInBranch, queryString, statusWhere } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const mount = { path: '/vendors', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

/** Vendors with what was bought from them and what is still owed (Σ total − paid). */
async function withBalances(branchId, vendors) {
  const sums = await prisma.purchase.groupBy({
    by: ['vendorId'],
    where: { branchId, vendorId: { in: vendors.map((v) => v.id) } },
    _sum: { totalPaise: true, paidPaise: true },
  });
  const byVendor = new Map(sums.map((s) => [s.vendorId, s._sum]));
  return vendors.map((vendor) => {
    const sum = byVendor.get(vendor.id);
    const purchasesTotalPaise = sum?.totalPaise ?? 0;
    return { ...vendor, purchasesTotalPaise, outstandingPaise: purchasesTotalPaise - (sum?.paidPaise ?? 0) };
  });
}

router.get('/', async (req, res) => {
  const q = queryString(req, 'q');
  const where = { branchId: req.branchId, ...statusWhere(req) };
  if (q) {
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { phone: { contains: q } },
      { gstin: { contains: q, mode: 'insensitive' } },
    ];
  }
  const vendors = await prisma.vendor.findMany({ where, orderBy: { name: 'asc' } });
  res.json({ data: await withBalances(req.branchId, vendors) });
});

router.post('/', canWrite, validateBody(vendorSchema), async (req, res) => {
  const vendor = await prisma.vendor.create({ data: { ...req.body, branchId: req.branchId } });
  res.status(201).json({ data: (await withBalances(req.branchId, [vendor]))[0] });
});

router.put('/:id', canWrite, validateBody(vendorSchema), async (req, res) => {
  await findInBranch(prisma.vendor, req.params.id, req.branchId, 'Vendor');
  const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: req.body });
  res.json({ data: (await withBalances(req.branchId, [vendor]))[0] });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.vendor, req.params.id, req.branchId, 'Vendor');
  const vendor = await prisma.vendor.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
  res.json({ data: (await withBalances(req.branchId, [vendor]))[0] });
});

export default router;
