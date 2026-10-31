import { Router } from 'express';
import {
  ACTIVE_APPOINTMENT_STATUSES, APPOINTMENT_STATUSES, APPOINTMENT_TRANSITIONS, appointmentAdvanceSchema, appointmentSchema,
  appointmentStatusSchema, appointmentUpdateSchema,
} from '@salon/shared/appointments';
import { prisma } from '../../db.js';
import { fromIsoDate, toIsoDate } from '../../lib/dates.js';
import { badRequest, conflict } from '../../lib/errors.js';
import { findInBranch, pageParams, queryString } from '../../lib/http.js';
import { validateBody } from '../../middleware/validate.js';
import {
  appointmentInclude, appointmentSpan, assertNoConflicts, assertNotHoliday, findClientInOrg, lockBranchBookings, queueConfirmation,
  resolveItems, toAppointmentDto,
} from '../../services/appointments.js';

export const mount = { path: '/appointments', scope: 'branch' };

// Appointments belong to the branch that booked them. Front desk users may book, edit and cancel.
const router = Router();
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const providerSelect = { id: true, name: true, designation: true, shiftStart: true, shiftEnd: true, isActive: true };

function dateParam(req, key) {
  const value = queryString(req, key);
  if (!value) return null;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) throw badRequest('Use YYYY-MM-DD', { [key]: 'Use YYYY-MM-DD' });
  return value;
}

async function loadAppointment(id, db = prisma) {
  return toAppointmentDto(await db.appointment.findUnique({ where: { id }, include: appointmentInclude }));
}

function assertEditable(appointment) {
  if (appointment.status === 'BILLED') throw conflict('This appointment has been billed and can no longer be changed');
  if (!ACTIVE_APPOINTMENT_STATUSES.includes(appointment.status)) {
    throw conflict('Only upcoming or checked-in appointments can be edited. Restore it first.');
  }
}

async function dayView(req, date) {
  const day = fromIsoDate(date);
  const [holiday, appointments, activeProviders] = await Promise.all([
    prisma.holiday.findUnique({ where: { branchId_date: { branchId: req.branchId, date: day } } }),
    prisma.appointment.findMany({
      where: { branchId: req.branchId, date: day },
      include: appointmentInclude,
      orderBy: [{ startTime: 'asc' }, { createdAt: 'asc' }],
    }),
    prisma.staff.findMany({
      where: { branchId: req.branchId, kind: 'SERVICE_PROVIDER', isActive: true },
      select: providerSelect,
      orderBy: { name: 'asc' },
    }),
  ]);

  // Keep columns for providers deactivated since they were booked, so their appointments stay visible.
  const known = new Set(activeProviders.map((p) => p.id));
  const missing = [...new Set(appointments.flatMap((a) => a.items.map((i) => i.staffId)).filter((id) => id && !known.has(id)))];
  const former = missing.length
    ? await prisma.staff.findMany({ where: { id: { in: missing } }, select: providerSelect, orderBy: { name: 'asc' } })
    : [];

  return {
    date,
    openTime: req.branch.openTime,
    closeTime: req.branch.closeTime,
    isHoliday: Boolean(holiday),
    holiday: holiday ? { id: holiday.id, date: toIsoDate(holiday.date), description: holiday.description } : null,
    providers: [...activeProviders, ...former],
    appointments: appointments.map(toAppointmentDto),
  };
}

router.get('/', async (req, res) => {
  const date = dateParam(req, 'date');
  if (date) return res.json({ data: await dayView(req, date) });

  const { page, pageSize, skip, take } = pageParams(req);
  const clientId = queryString(req, 'clientId');
  const status = queryString(req, 'status');
  const from = dateParam(req, 'from');
  const to = dateParam(req, 'to');

  const where = { branchId: req.branchId };
  if (clientId) where.clientId = clientId;
  if (APPOINTMENT_STATUSES.includes(status)) where.status = status;
  if (from || to) where.date = { ...(from && { gte: fromIsoDate(from) }), ...(to && { lte: fromIsoDate(to) }) };

  const [items, total] = await prisma.$transaction([
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy: [{ date: 'desc' }, { startTime: 'desc' }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.appointment.count({ where }),
  ]);
  res.json({ data: { items: items.map(toAppointmentDto), total, page, pageSize } });
});

router.get('/:id', async (req, res) => {
  await findInBranch(prisma.appointment, req.params.id, req.branchId, 'Appointment');
  res.json({ data: await loadAppointment(req.params.id) });
});

router.post('/', validateBody(appointmentSchema), async (req, res) => {
  const { clientId, date, source, notes, items, advance, notifyClient } = req.body;
  const appointment = await prisma.$transaction(async (tx) => {
    const client = await findClientInOrg(tx, clientId, req.branch.organizationId);
    await assertNotHoliday(tx, req.branchId, date);
    const resolved = await resolveItems(tx, req.branchId, items);
    await lockBranchBookings(tx, req.branchId);
    await assertNoConflicts(tx, { branchId: req.branchId, date, items: resolved });

    const created = await tx.appointment.create({
      data: {
        branchId: req.branchId,
        clientId: client.id,
        date: fromIsoDate(date),
        ...appointmentSpan(resolved),
        status: 'BOOKED',
        source,
        notes,
        createdById: req.user.id,
        items: { create: resolved },
      },
    });
    if (advance) {
      await tx.payment.create({
        data: {
          branchId: req.branchId,
          clientId: client.id,
          appointmentId: created.id,
          kind: 'ADVANCE',
          method: advance.method,
          amountPaise: advance.amountPaise,
          reference: advance.reference,
          createdById: req.user.id,
        },
      });
    }
    if (notifyClient) {
      await queueConfirmation(tx, { branchId: req.branchId, client, date, startTime: created.startTime, createdById: req.user.id });
    }
    return loadAppointment(created.id, tx);
  });
  res.status(201).json({ data: appointment });
});

router.put('/:id', validateBody(appointmentUpdateSchema), async (req, res) => {
  const existing = await findInBranch(prisma.appointment, req.params.id, req.branchId, 'Appointment');
  assertEditable(existing);
  const { clientId, date, source, notes, items, notifyClient } = req.body;

  const appointment = await prisma.$transaction(async (tx) => {
    const client = await findClientInOrg(tx, clientId, req.branch.organizationId);
    await assertNotHoliday(tx, req.branchId, date);
    const resolved = await resolveItems(tx, req.branchId, items);
    await lockBranchBookings(tx, req.branchId);
    // Re-read under the lock: billing may have closed it in the meantime.
    assertEditable(await tx.appointment.findUnique({ where: { id: existing.id } }));
    await assertNoConflicts(tx, { branchId: req.branchId, date, items: resolved, excludeId: existing.id });

    await tx.appointmentItem.deleteMany({ where: { appointmentId: existing.id } });
    const updated = await tx.appointment.update({
      where: { id: existing.id },
      data: { clientId: client.id, date: fromIsoDate(date), ...appointmentSpan(resolved), source, notes, items: { create: resolved } },
    });
    if (client.id !== existing.clientId) {
      await tx.payment.updateMany({ where: { appointmentId: existing.id, billId: null }, data: { clientId: client.id } });
    }
    if (notifyClient) {
      await queueConfirmation(tx, { branchId: req.branchId, client, date, startTime: updated.startTime, createdById: req.user.id });
    }
    return loadAppointment(existing.id, tx);
  });
  res.json({ data: appointment });
});

router.patch('/:id/status', validateBody(appointmentStatusSchema), async (req, res) => {
  const existing = await findInBranch(prisma.appointment, req.params.id, req.branchId, 'Appointment');
  const { status, cancelReason } = req.body;
  if (existing.status === 'BILLED') throw conflict('This appointment has been billed and can no longer be changed');
  if (!APPOINTMENT_TRANSITIONS[existing.status].includes(status)) {
    throw conflict(`An appointment that is ${existing.status.toLowerCase().replace('_', ' ')} cannot be marked ${status.toLowerCase().replace('_', ' ')}`);
  }

  const appointment = await prisma.$transaction(async (tx) => {
    await lockBranchBookings(tx, req.branchId);
    const current = await tx.appointment.findUnique({ where: { id: existing.id }, include: { items: true } });
    if (current.status !== existing.status) throw conflict('This appointment was just changed by someone else. Reload and try again.');
    // Restoring a cancelled/no-show booking takes its slots back, which someone else may have taken.
    if (!ACTIVE_APPOINTMENT_STATUSES.includes(current.status)) {
      await assertNoConflicts(tx, { branchId: req.branchId, date: toIsoDate(current.date), items: current.items, excludeId: current.id });
    }
    await tx.appointment.update({
      where: { id: current.id },
      data: { status, cancelReason: status === 'CANCELLED' ? cancelReason : null },
    });
    return loadAppointment(current.id, tx);
  });
  res.json({ data: appointment });
});

router.post('/:id/advance', validateBody(appointmentAdvanceSchema), async (req, res) => {
  const appointment = await findInBranch(prisma.appointment, req.params.id, req.branchId, 'Appointment');
  if (appointment.status === 'BILLED') throw conflict('This appointment has been billed; take the payment on the bill instead');
  if (appointment.status === 'CANCELLED') throw conflict('This appointment is cancelled');
  const payment = await prisma.payment.create({
    data: {
      branchId: req.branchId,
      clientId: appointment.clientId,
      appointmentId: appointment.id,
      kind: 'ADVANCE',
      method: req.body.method,
      amountPaise: req.body.amountPaise,
      reference: req.body.reference,
      createdById: req.user.id,
    },
    select: appointmentInclude.payments.select,
  });
  res.status(201).json({ data: payment });
});

export default router;
