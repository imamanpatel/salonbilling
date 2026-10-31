import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { todayIso } from '../../lib/dates.js';
import { dashboard } from '../../services/reports.js';

export const mount = { path: '/dashboard', scope: 'branch' };

const router = Router();

router.get('/', async (req, res) => {
  const data = await dashboard({
    prisma,
    branchId: req.branchId,
    organizationId: req.branch.organizationId,
    timeZone: config.timezone,
    today: todayIso(config.timezone),
  });
  // Front desk sees footfall, not takings.
  if (req.user.role === ROLES.USER) {
    data.today.salesPaise = null;
    data.today.collectionsPaise = null;
    data.last30Days = null;
    data.topServicesThisMonth = null;
  }
  res.json({ data });
});

export default router;
