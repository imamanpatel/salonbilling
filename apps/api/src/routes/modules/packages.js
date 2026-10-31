import { Router } from 'express';
import { ROLES, statusSchema } from '@salon/shared';
import { packageSchema } from '@salon/shared/catalogue';
import { prisma } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { findInBranch, statusWhere } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const mount = { path: '/packages', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const include = {
  items: { include: { service: { select: { id: true, name: true, pricePaise: true } } }, orderBy: { service: { name: 'asc' } } },
  _count: { select: { clientPackages: true } },
};

const toDto = ({ _count, ...pkg }) => ({
  ...pkg,
  servicesValuePaise: pkg.items.reduce((sum, item) => sum + item.service.pricePaise * item.qty, 0),
  soldCount: _count.clientPackages,
});

/** Every item must be an active service of the branch; services already in the package may stay even if deactivated. */
async function assertServices(items, branchId, keepIds = []) {
  const ids = items.map((item) => item.serviceId);
  const found = await prisma.service.findMany({
    where: { id: { in: ids }, branchId, OR: [{ isActive: true }, { id: { in: keepIds } }] },
    select: { id: true },
  });
  const valid = new Set(found.map((s) => s.id));
  const details = {};
  items.forEach((item, index) => {
    if (!valid.has(item.serviceId)) details[`items.${index}.serviceId`] = 'Pick an active service of this branch';
  });
  if (Object.keys(details).length) throw badRequest('Pick active services of this branch', details);
}

const fields = ({ items, ...rest }) => rest;
const itemRows = (items) => items.map(({ serviceId, qty }) => ({ serviceId, qty }));

router.get('/', async (req, res) => {
  const rows = await prisma.package.findMany({
    where: { branchId: req.branchId, ...statusWhere(req) },
    include,
    orderBy: { name: 'asc' },
  });
  res.json({ data: rows.map(toDto) });
});

router.post('/', canWrite, validateBody(packageSchema), async (req, res) => {
  await assertServices(req.body.items, req.branchId);
  const row = await prisma.package.create({
    data: { ...fields(req.body), branchId: req.branchId, items: { create: itemRows(req.body.items) } },
    include,
  });
  res.status(201).json({ data: toDto(row) });
});

router.put('/:id', canWrite, validateBody(packageSchema), async (req, res) => {
  await findInBranch(prisma.package, req.params.id, req.branchId, 'Package');
  const current = await prisma.packageItem.findMany({ where: { packageId: req.params.id }, select: { serviceId: true } });
  await assertServices(req.body.items, req.branchId, current.map((item) => item.serviceId));
  const row = await prisma.package.update({
    where: { id: req.params.id },
    data: { ...fields(req.body), items: { deleteMany: {}, create: itemRows(req.body.items) } },
    include,
  });
  res.json({ data: toDto(row) });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.package, req.params.id, req.branchId, 'Package');
  const row = await prisma.package.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive }, include });
  res.json({ data: toDto(row) });
});

export default router;
