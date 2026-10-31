import { Router } from 'express';
import { ROLES, statusSchema } from '@salon/shared';
import { couponSchema } from '@salon/shared/catalogue';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { findInBranch, statusWhere } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

export const mount = { path: '/coupons', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
// Voided bills give the coupon use back.
const include = { _count: { select: { bills: { where: { status: { not: 'VOID' } } } } } };

const toDto = ({ _count, ...coupon }, today) => {
  const validTo = toIsoDate(coupon.validTo);
  return {
    ...coupon,
    discountPct: coupon.discountPct == null ? null : Number(coupon.discountPct),
    validFrom: toIsoDate(coupon.validFrom),
    validTo,
    usedCount: _count?.bills ?? 0,
    expired: Boolean(validTo && validTo < today),
  };
};

const toData = (body) => ({ ...body, validFrom: fromIsoDate(body.validFrom), validTo: fromIsoDate(body.validTo) });

router.get('/', async (req, res) => {
  const rows = await prisma.coupon.findMany({
    where: { branchId: req.branchId, ...statusWhere(req) },
    include,
    orderBy: [{ createdAt: 'desc' }],
  });
  const today = todayIso(config.timezone);
  res.json({ data: rows.map((row) => toDto(row, today)) });
});

router.post('/', canWrite, validateBody(couponSchema), async (req, res) => {
  const row = await prisma.coupon.create({ data: { ...toData(req.body), branchId: req.branchId }, include });
  res.status(201).json({ data: toDto(row, todayIso(config.timezone)) });
});

router.put('/:id', canWrite, validateBody(couponSchema), async (req, res) => {
  await findInBranch(prisma.coupon, req.params.id, req.branchId, 'Coupon');
  const row = await prisma.coupon.update({ where: { id: req.params.id }, data: toData(req.body), include });
  res.json({ data: toDto(row, todayIso(config.timezone)) });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.coupon, req.params.id, req.branchId, 'Coupon');
  const row = await prisma.coupon.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive }, include });
  res.json({ data: toDto(row, todayIso(config.timezone)) });
});

export default router;
