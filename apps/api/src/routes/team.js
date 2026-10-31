import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { prisma } from '../db.js';

const router = Router();

/** Active users who can work in the current branch, for "assigned to" pickers. Visible to every role. */
router.get('/', async (req, res) => {
  const users = await prisma.user.findMany({
    where: {
      organizationId: req.branch.organizationId,
      isActive: true,
      OR: [{ role: ROLES.SUPERADMIN }, { branches: { some: { branchId: req.branchId } } }],
    },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  res.json({ data: users });
});

export default router;
