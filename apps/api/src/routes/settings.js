import { Router } from 'express';
import { holidaySchema, ROLES, settingsSchema, taxSchema } from '@salon/shared';
import { prisma } from '../db.js';
import { fromIsoDate, toIsoDate } from '../lib/dates.js';
import { findInBranch } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);

const taxDto = (tax) => ({ ...tax, ratePct: Number(tax.ratePct) });
const holidayDto = (holiday) => ({ ...holiday, date: toIsoDate(holiday.date) });

router.get('/', async (req, res) => {
  const setting = await prisma.branchSetting.upsert({
    where: { branchId: req.branchId },
    create: { branchId: req.branchId },
    update: {},
  });
  res.json({ data: setting });
});

router.put('/', canWrite, validateBody(settingsSchema), async (req, res) => {
  const setting = await prisma.branchSetting.upsert({
    where: { branchId: req.branchId },
    create: { ...req.body, branchId: req.branchId },
    update: req.body,
  });
  res.json({ data: setting });
});

router.get('/taxes', async (req, res) => {
  const taxes = await prisma.taxRate.findMany({
    where: { branchId: req.branchId },
    orderBy: [{ isActive: 'desc' }, { appliesTo: 'asc' }, { ratePct: 'asc' }],
  });
  res.json({ data: taxes.map(taxDto) });
});

router.post('/taxes', canWrite, validateBody(taxSchema), async (req, res) => {
  const tax = await prisma.taxRate.create({ data: { ...req.body, branchId: req.branchId } });
  res.status(201).json({ data: taxDto(tax) });
});

router.put('/taxes/:id', canWrite, validateBody(taxSchema), async (req, res) => {
  await findInBranch(prisma.taxRate, req.params.id, req.branchId, 'Tax');
  const tax = await prisma.taxRate.update({ where: { id: req.params.id }, data: req.body });
  res.json({ data: taxDto(tax) });
});

router.get('/holidays', async (req, res) => {
  const holidays = await prisma.holiday.findMany({ where: { branchId: req.branchId }, orderBy: { date: 'asc' } });
  res.json({ data: holidays.map(holidayDto) });
});

router.post('/holidays', canWrite, validateBody(holidaySchema), async (req, res) => {
  const holiday = await prisma.holiday.create({
    data: { branchId: req.branchId, date: fromIsoDate(req.body.date), description: req.body.description },
  });
  res.status(201).json({ data: holidayDto(holiday) });
});

router.delete('/holidays/:id', canWrite, async (req, res) => {
  await findInBranch(prisma.holiday, req.params.id, req.branchId, 'Holiday');
  await prisma.holiday.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
