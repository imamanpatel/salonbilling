import { Router } from 'express';
import { attendanceClockSchema, attendanceSchema } from '@salon/shared/hr';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { conflict } from '../../lib/errors.js';
import { findInBranch } from '../../lib/http.js';
import { validateBody } from '../../middleware/validate.js';
import { dateParam, monthDays, monthParam, monthRange, nowTime, STAFF_ORDER, staffSummary } from '../../services/hr.js';

// Any signed-in role may mark attendance (the front desk usually does it).
export const mount = { path: '/attendance', scope: 'branch' };

const router = Router();

const recordDto = (row) =>
  row && { id: row.id, staffId: row.staffId, date: toIsoDate(row.date), status: row.status, checkIn: row.checkIn, checkOut: row.checkOut, note: row.note };

const activeStaff = (branchId) => prisma.staff.findMany({ where: { branchId, isActive: true }, orderBy: STAFF_ORDER });

router.get('/', async (req, res) => {
  const date = dateParam(req, 'date', todayIso(config.timezone));
  const [staff, records] = await Promise.all([
    activeStaff(req.branchId),
    prisma.attendance.findMany({ where: { branchId: req.branchId, date: fromIsoDate(date) } }),
  ]);
  const byStaff = new Map(records.map((r) => [r.staffId, r]));
  res.json({ data: staff.map((s) => ({ staff: staffSummary(s), record: recordDto(byStaff.get(s.id)) ?? null })) });
});

router.get('/monthly', async (req, res) => {
  const month = monthParam(req);
  const { from, to } = monthRange(month);
  const records = await prisma.attendance.findMany({
    where: { branchId: req.branchId, date: { gte: fromIsoDate(from), lte: fromIsoDate(to) } },
  });
  // Active staff plus anyone with records here that month (deactivated or transferred since).
  const staff = await prisma.staff.findMany({
    where: { OR: [{ branchId: req.branchId, isActive: true }, { id: { in: [...new Set(records.map((r) => r.staffId))] } }] },
    orderBy: STAFF_ORDER,
  });

  const rows = staff.map((s) => {
    const own = records.filter((r) => r.staffId === s.id);
    const count = (status) => own.filter((r) => r.status === status).length;
    return {
      id: s.id,
      name: s.name,
      kind: s.kind,
      records: Object.fromEntries(own.map((r) => [toIsoDate(r.date), { status: r.status, checkIn: r.checkIn, checkOut: r.checkOut }])),
      summary: { present: count('PRESENT'), halfDay: count('HALF_DAY'), absent: count('ABSENT'), leave: count('LEAVE') },
    };
  });
  res.json({ data: { month, days: monthDays(month), staff: rows } });
});

router.put('/', validateBody(attendanceSchema), async (req, res) => {
  const { staffId, date, ...fields } = req.body;
  await findInBranch(prisma.staff, staffId, req.branchId, 'Staff member');
  const row = await prisma.attendance.upsert({
    where: { staffId_date: { staffId, date: fromIsoDate(date) } },
    create: { ...fields, staffId, date: fromIsoDate(date), branchId: req.branchId },
    update: { ...fields, branchId: req.branchId },
  });
  res.json({ data: recordDto(row) });
});

async function todayRecord(req) {
  const staff = await findInBranch(prisma.staff, req.body.staffId, req.branchId, 'Staff member');
  const date = fromIsoDate(todayIso(config.timezone));
  const record = await prisma.attendance.findUnique({ where: { staffId_date: { staffId: staff.id, date } } });
  return { staff, date, record };
}

router.post('/check-in', validateBody(attendanceClockSchema), async (req, res) => {
  const { staff, date, record } = await todayRecord(req);
  if (record?.checkIn) throw conflict(`${staff.name} already checked in at ${record.checkIn}`);
  const checkIn = nowTime();
  const row = await prisma.attendance.upsert({
    where: { staffId_date: { staffId: staff.id, date } },
    create: { staffId: staff.id, date, branchId: req.branchId, status: 'PRESENT', checkIn },
    update: { status: 'PRESENT', checkIn, checkOut: null },
  });
  res.json({ data: recordDto(row) });
});

router.post('/check-out', validateBody(attendanceClockSchema), async (req, res) => {
  const { staff, record } = await todayRecord(req);
  if (!record?.checkIn) throw conflict(`${staff.name} has not checked in today`);
  const now = nowTime();
  // Never record a check-out before the check-in (e.g. a check-in typed in by hand for later today).
  const row = await prisma.attendance.update({ where: { id: record.id }, data: { checkOut: now < record.checkIn ? record.checkIn : now } });
  res.json({ data: recordDto(row) });
});

export default router;
