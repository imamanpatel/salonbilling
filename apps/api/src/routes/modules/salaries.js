import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { SALARY_KINDS, salaryEntrySchema, suggestedPayable } from '@salon/shared/hr';
import { prisma } from '../../db.js';
import { fromIsoDate, toIsoDate } from '../../lib/dates.js';
import { findInBranch } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { businessRange, monthParam, monthRange, STAFF_ORDER, staffSummary } from '../../services/hr.js';

export const mount = { path: '/salaries', scope: 'branch' };

const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const entryDto = (entry) => ({ ...entry, paidOn: toIsoDate(entry.paidOn) });

router.get('/', async (req, res) => {
  const month = monthParam(req);
  const { from, to } = monthRange(month);
  const [entries, commissions] = await Promise.all([
    prisma.salaryEntry.findMany({ where: { branchId: req.branchId, forMonth: month }, orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }] }),
    prisma.billItem.groupBy({
      by: ['staffId'],
      where: { staffId: { not: null }, bill: { branchId: req.branchId, status: { not: 'VOID' }, billedAt: businessRange(from, to) } },
      _sum: { commissionPaise: true },
    }),
  ]);
  const commissionBy = new Map(commissions.map((c) => [c.staffId, c._sum.commissionPaise ?? 0]));

  // Active staff, plus anyone paid or earning commission here that month (deactivated or transferred since).
  const extraIds = [...new Set([...entries.map((e) => e.staffId), ...commissionBy.keys()])];
  const staff = await prisma.staff.findMany({
    where: { OR: [{ branchId: req.branchId, isActive: true }, { id: { in: extraIds } }] },
    orderBy: STAFF_ORDER,
  });

  const rows = staff.map((s) => {
    const own = entries.filter((e) => e.staffId === s.id);
    const totalsByKind = Object.fromEntries(SALARY_KINDS.map((kind) => [kind, 0]));
    for (const e of own) totalsByKind[e.kind] += e.amountPaise;
    const commissionPaise = commissionBy.get(s.id) ?? 0;
    return {
      staff: staffSummary(s),
      monthlySalaryPaise: s.monthlySalaryPaise,
      entries: own.map(entryDto),
      totalsByKind,
      commissionPaise,
      paidSalaryPaise: totalsByKind.SALARY,
      suggestedPayablePaise: suggestedPayable({ monthlySalaryPaise: s.monthlySalaryPaise, commissionPaise, totalsByKind }),
    };
  });
  res.json({ data: rows });
});

router.post('/', validateBody(salaryEntrySchema), async (req, res) => {
  await findInBranch(prisma.staff, req.body.staffId, req.branchId, 'Staff member');
  const entry = await prisma.salaryEntry.create({
    data: { ...req.body, paidOn: fromIsoDate(req.body.paidOn), branchId: req.branchId, createdById: req.user.id },
  });
  res.status(201).json({ data: entryDto(entry) });
});

router.delete('/:id', async (req, res) => {
  await findInBranch(prisma.salaryEntry, req.params.id, req.branchId, 'Salary entry');
  await prisma.salaryEntry.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
