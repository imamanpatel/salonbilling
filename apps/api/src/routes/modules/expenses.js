import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { DEFAULT_EXPENSE_CATEGORIES, expenseSchema } from '@salon/shared/hr';
import { prisma } from '../../db.js';
import { fromIsoDate, toIsoDate } from '../../lib/dates.js';
import { findInBranch, pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { rangeParams } from '../../services/hr.js';

export const mount = { path: '/expenses', scope: 'branch' };

const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const toData = (body) => ({ ...body, spentOn: fromIsoDate(body.spentOn) });
const toDto = (expense) => ({ ...expense, spentOn: toIsoDate(expense.spentOn) });

// totalsByCategory covers the whole date range (so the category chips stay visible while filtering);
// totalPaise matches the filtered list.
router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const { from, to } = rangeParams(req);
  const category = queryString(req, 'category');

  const rangeWhere = { branchId: req.branchId, spentOn: { gte: fromIsoDate(from), lte: fromIsoDate(to) } };
  const where = category ? { ...rangeWhere, category: { equals: category, mode: 'insensitive' } } : rangeWhere;

  const [items, total, sum, byCategory] = await prisma.$transaction([
    prisma.expense.findMany({ where, orderBy: [{ spentOn: 'desc' }, { createdAt: 'desc' }], skip, take }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amountPaise: true } }),
    prisma.expense.groupBy({ by: ['category'], where: rangeWhere, _sum: { amountPaise: true }, _count: { _all: true }, orderBy: { category: 'asc' } }),
  ]);

  const totalsByCategory = byCategory
    .map((g) => ({ category: g.category, amountPaise: g._sum.amountPaise ?? 0, count: g._count._all }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
  res.json({
    data: { items: items.map(toDto), total, page, pageSize, from, to, totalsByCategory, totalPaise: sum._sum.amountPaise ?? 0 },
  });
});

router.get('/categories', async (req, res) => {
  const used = await prisma.expense.findMany({
    where: { branchId: req.branchId },
    distinct: ['category'],
    select: { category: true },
    orderBy: { category: 'asc' },
  });
  const seen = new Set(DEFAULT_EXPENSE_CATEGORIES.map((c) => c.toLowerCase()));
  const extra = used.map((u) => u.category).filter((c) => !seen.has(c.toLowerCase()) && seen.add(c.toLowerCase()));
  res.json({ data: [...DEFAULT_EXPENSE_CATEGORIES, ...extra] });
});

router.post('/', validateBody(expenseSchema), async (req, res) => {
  const expense = await prisma.expense.create({ data: { ...toData(req.body), branchId: req.branchId, createdById: req.user.id } });
  res.status(201).json({ data: toDto(expense) });
});

router.put('/:id', validateBody(expenseSchema), async (req, res) => {
  await findInBranch(prisma.expense, req.params.id, req.branchId, 'Expense');
  const expense = await prisma.expense.update({ where: { id: req.params.id }, data: toData(req.body) });
  res.json({ data: toDto(expense) });
});

router.delete('/:id', async (req, res) => {
  await findInBranch(prisma.expense, req.params.id, req.branchId, 'Expense');
  await prisma.expense.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
