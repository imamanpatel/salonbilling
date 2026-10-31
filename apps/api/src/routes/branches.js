import { Router } from 'express';
import { branchSchema, ROLES } from '@salon/shared';
import { prisma } from '../db.js';
import { notFound } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { createBranchDefaults } from '../services/branchDefaults.js';

const router = Router();
router.use(requireRole(ROLES.SUPERADMIN));

router.get('/', async (req, res) => {
  const branches = await prisma.branch.findMany({
    where: { organizationId: req.user.organizationId },
    orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
  });
  res.json({ data: branches });
});

router.post('/', validateBody(branchSchema), async (req, res) => {
  const branch = await prisma.$transaction(async (tx) => {
    const created = await tx.branch.create({ data: { ...req.body, organizationId: req.user.organizationId } });
    await createBranchDefaults(tx, created.id);
    return created;
  });
  res.status(201).json({ data: branch });
});

router.put('/:id', validateBody(branchSchema), async (req, res) => {
  const existing = await prisma.branch.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
  if (!existing) throw notFound('Branch');
  const branch = await prisma.branch.update({ where: { id: existing.id }, data: req.body });
  res.json({ data: branch });
});

export default router;
