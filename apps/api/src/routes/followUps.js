import { Router } from 'express';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../lib/dates.js';
import { upcomingOccasions } from '../services/occasions.js';

const router = Router();
const OCCASION_DAYS = 7;
const MAX_ITEMS = 200;

/** The front desk's to-do list: upcoming birthdays/anniversaries and follow-ups due today or overdue. */
router.get('/today', async (req, res) => {
  const today = todayIso(config.timezone);
  const organizationId = req.branch.organizationId;

  const [birthdays, anniversaries, enquiries, clientFollowUps] = await Promise.all([
    upcomingOccasions(prisma, organizationId, 'dob', today, OCCASION_DAYS),
    upcomingOccasions(prisma, organizationId, 'anniversary', today, OCCASION_DAYS),
    prisma.enquiry.findMany({
      where: { branchId: req.branchId, status: 'PENDING', followUpOn: { lte: fromIsoDate(today) } },
      include: { assignedTo: { select: { id: true, name: true } } },
      orderBy: { followUpOn: 'asc' },
      take: MAX_ITEMS,
    }),
    prisma.clientFollowUp.findMany({
      where: { branchId: req.branchId, completedAt: null, dueOn: { lte: fromIsoDate(today) } },
      include: { client: { select: { id: true, name: true, phone: true } }, createdBy: { select: { name: true } } },
      orderBy: [{ dueOn: 'asc' }, { dueTime: 'asc' }],
      take: MAX_ITEMS,
    }),
  ]);

  res.json({
    data: {
      today,
      birthdays,
      anniversaries,
      enquiries: enquiries.map((e) => ({ ...e, followUpOn: toIsoDate(e.followUpOn) })),
      clientFollowUps: clientFollowUps.map((f) => ({ ...f, dueOn: toIsoDate(f.dueOn) })),
    },
  });
});

export default router;
