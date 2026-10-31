import { Router } from 'express';
import { ROLES, statusSchema } from '@salon/shared';
import { membershipPlanSchema } from '@salon/shared/catalogue';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { findInBranch, pageParams, queryString, statusWhere } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const mount = { path: '/memberships', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

/** A membership counts as active until its end date unless it was cancelled. */
const activeWhere = (today) => ({ cancelledAt: null, endsOn: { gte: fromIsoDate(today) } });

const planDto = ({ _count, ...plan }) => ({
  ...plan,
  productDiscountPct: Number(plan.productDiscountPct),
  packageDiscountPct: Number(plan.packageDiscountPct),
  activeMembers: _count?.clientMemberships ?? 0,
});

const planInclude = (today) => ({ _count: { select: { clientMemberships: { where: activeWhere(today) } } } });

router.get('/', async (req, res) => {
  const today = todayIso(config.timezone);
  const rows = await prisma.membershipPlan.findMany({
    where: { branchId: req.branchId, ...statusWhere(req) },
    include: planInclude(today),
    orderBy: [{ pricePaise: 'asc' }, { name: 'asc' }],
  });
  res.json({ data: rows.map(planDto) });
});

router.get('/members', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const today = todayIso(config.timezone);
  const status = queryString(req, 'status') || 'active';
  const where = { plan: { branchId: req.branchId } };
  if (status === 'active') Object.assign(where, activeWhere(today));
  if (status === 'expired') where.OR = [{ cancelledAt: { not: null } }, { endsOn: { lt: fromIsoDate(today) } }];

  const [items, total] = await prisma.$transaction([
    prisma.clientMembership.findMany({
      where,
      include: { client: { select: { id: true, name: true, phone: true } }, plan: { select: { id: true, name: true } } },
      orderBy: status === 'active' ? [{ endsOn: 'asc' }, { createdAt: 'asc' }] : [{ endsOn: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.clientMembership.count({ where }),
  ]);
  const dto = (m) => {
    const endsOn = toIsoDate(m.endsOn);
    return {
      id: m.id,
      client: m.client,
      planId: m.plan.id,
      planName: m.plan.name,
      startsOn: toIsoDate(m.startsOn),
      endsOn,
      cancelledAt: m.cancelledAt,
      billId: m.billId,
      active: !m.cancelledAt && endsOn >= today,
    };
  };
  res.json({ data: { items: items.map(dto), total, page, pageSize } });
});

router.post('/', canWrite, validateBody(membershipPlanSchema), async (req, res) => {
  const row = await prisma.membershipPlan.create({ data: { ...req.body, branchId: req.branchId } });
  res.status(201).json({ data: planDto(row) });
});

router.put('/:id', canWrite, validateBody(membershipPlanSchema), async (req, res) => {
  await findInBranch(prisma.membershipPlan, req.params.id, req.branchId, 'Membership plan');
  const row = await prisma.membershipPlan.update({
    where: { id: req.params.id },
    data: req.body,
    include: planInclude(todayIso(config.timezone)),
  });
  res.json({ data: planDto(row) });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.membershipPlan, req.params.id, req.branchId, 'Membership plan');
  const row = await prisma.membershipPlan.update({
    where: { id: req.params.id },
    data: { isActive: req.body.isActive },
    include: planInclude(todayIso(config.timezone)),
  });
  res.json({ data: planDto(row) });
});

export default router;
