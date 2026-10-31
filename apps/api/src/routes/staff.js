import { Router } from 'express';
import { ROLES, STAFF_KINDS, staffSchema, statusSchema } from '@salon/shared';
import { prisma } from '../db.js';
import { fromIsoDate, toIsoDate } from '../lib/dates.js';
import { findInBranch, queryString, statusWhere } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

const toData = (body) => ({ ...body, dob: fromIsoDate(body.dob), joinedOn: fromIsoDate(body.joinedOn) });
const toDto = (staff) => ({
  ...staff,
  dob: toIsoDate(staff.dob),
  joinedOn: toIsoDate(staff.joinedOn),
  serviceCommissionPct: Number(staff.serviceCommissionPct),
  productCommissionPct: Number(staff.productCommissionPct),
});

// Front-desk users can see who works here, but not what they are paid.
const toListDto = (staff, role) => {
  const dto = toDto(staff);
  if (role === ROLES.USER) delete dto.monthlySalaryPaise;
  return dto;
};

router.get('/', async (req, res) => {
  const kind = queryString(req, 'kind');
  const q = queryString(req, 'q');
  const where = { branchId: req.branchId, ...statusWhere(req) };
  if (Object.values(STAFF_KINDS).includes(kind)) where.kind = kind;
  if (q) where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { phone: { contains: q } }];

  const rows = await prisma.staff.findMany({ where, orderBy: { name: 'asc' } });
  res.json({ data: rows.map((row) => toListDto(row, req.user.role)) });
});

router.post('/', canWrite, validateBody(staffSchema), async (req, res) => {
  const row = await prisma.staff.create({ data: { ...toData(req.body), branchId: req.branchId } });
  res.status(201).json({ data: toDto(row) });
});

router.put('/:id', canWrite, validateBody(staffSchema), async (req, res) => {
  await findInBranch(prisma.staff, req.params.id, req.branchId, 'Staff member');
  const row = await prisma.staff.update({ where: { id: req.params.id }, data: toData(req.body) });
  res.json({ data: toDto(row) });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.staff, req.params.id, req.branchId, 'Staff member');
  const row = await prisma.staff.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive } });
  res.json({ data: toDto(row) });
});

export default router;
