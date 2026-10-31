import { Router } from 'express';
import { categorySchema, ROLES } from '@salon/shared';
import { prisma } from '../db.js';
import { conflict } from '../lib/errors.js';
import { findInBranch } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

router.get('/', async (req, res) => {
  const rows = await prisma.serviceCategory.findMany({
    where: { branchId: req.branchId },
    orderBy: { name: 'asc' },
    include: { _count: { select: { services: true } } },
  });
  res.json({ data: rows.map(({ _count, ...category }) => ({ ...category, serviceCount: _count.services })) });
});

router.post('/', canWrite, validateBody(categorySchema), async (req, res) => {
  const row = await prisma.serviceCategory.create({ data: { ...req.body, branchId: req.branchId } });
  res.status(201).json({ data: { ...row, serviceCount: 0 } });
});

router.put('/:id', canWrite, validateBody(categorySchema), async (req, res) => {
  await findInBranch(prisma.serviceCategory, req.params.id, req.branchId, 'Category');
  const row = await prisma.serviceCategory.update({ where: { id: req.params.id }, data: req.body });
  res.json({ data: row });
});

router.delete('/:id', canWrite, async (req, res) => {
  await findInBranch(prisma.serviceCategory, req.params.id, req.branchId, 'Category');
  const inUse = await prisma.service.count({ where: { categoryId: req.params.id } });
  if (inUse) throw conflict(`Move or delete the ${inUse} service(s) in this category first`);
  await prisma.serviceCategory.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
