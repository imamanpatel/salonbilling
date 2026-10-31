import { ACTIVE_APPOINTMENT_STATUSES, addMinutesToTime, timesOverlap } from '@salon/shared/appointments';
import { fromIsoDate, toIsoDate } from '../lib/dates.js';
import { badRequest, conflict } from '../lib/errors.js';
import { queueTemplated } from './messaging.js';

export const appointmentInclude = {
  client: { select: { id: true, name: true, phone: true, email: true } },
  items: {
    include: {
      service: { select: { id: true, name: true, durationMin: true } },
      staff: { select: { id: true, name: true } },
    },
    orderBy: [{ startTime: 'asc' }, { endTime: 'asc' }],
  },
  payments: {
    select: { id: true, kind: true, method: true, amountPaise: true, reference: true, receivedAt: true, billId: true },
    orderBy: { receivedAt: 'asc' },
  },
};

export function toAppointmentDto(appointment) {
  const { payments = [], items = [] } = appointment;
  return {
    ...appointment,
    date: toIsoDate(appointment.date),
    advancePaise: payments.filter((p) => p.kind === 'ADVANCE').reduce((sum, p) => sum + p.amountPaise, 0),
    totalPaise: items.reduce((sum, item) => sum + item.pricePaise, 0),
  };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-10-31" -> "31 Oct 2026" (fixed format for client messages, independent of ICU data). */
export function formatMessageDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

/**
 * Serialises bookings per branch for the rest of the transaction, so two desks can't both pass the
 * double-booking check for the same slot.
 */
export async function lockBranchBookings(tx, branchId) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`appointments:${branchId}`}))`;
}

export async function assertNotHoliday(tx, branchId, date) {
  const holiday = await tx.holiday.findUnique({ where: { branchId_date: { branchId, date: fromIsoDate(date) } } });
  if (holiday) {
    const message = `The salon is closed on ${formatMessageDate(date)} (${holiday.description})`;
    throw badRequest(message, { date: `Closed: ${holiday.description}` });
  }
}

export async function findClientInOrg(tx, clientId, organizationId) {
  const client = await tx.client.findFirst({
    where: { id: clientId, organizationId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (!client) throw badRequest('Pick a valid client', { clientId: 'Pick a valid client' });
  return client;
}

/** Validates services/providers and fills in default end times and prices. Errors are keyed `items.<i>.<field>`. */
export async function resolveItems(tx, branchId, items) {
  const serviceIds = [...new Set(items.map((item) => item.serviceId))];
  const staffIds = [...new Set(items.map((item) => item.staffId).filter(Boolean))];
  const [services, staff] = await Promise.all([
    tx.service.findMany({ where: { id: { in: serviceIds }, branchId, isActive: true } }),
    tx.staff.findMany({
      where: { id: { in: staffIds }, branchId, kind: 'SERVICE_PROVIDER', isActive: true },
      select: { id: true },
    }),
  ]);
  const serviceById = new Map(services.map((s) => [s.id, s]));
  const staffIdSet = new Set(staff.map((s) => s.id));

  const errors = {};
  const resolved = items.map((item, index) => {
    const service = serviceById.get(item.serviceId);
    if (!service) {
      errors[`items.${index}.serviceId`] = 'Pick a valid service';
      return null;
    }
    if (item.staffId && !staffIdSet.has(item.staffId)) errors[`items.${index}.staffId`] = 'Pick an active service provider';
    const endTime = item.endTime ?? addMinutesToTime(item.startTime, service.durationMin);
    if (!endTime) errors[`items.${index}.endTime`] = 'Ends after midnight';
    return {
      serviceId: service.id,
      staffId: item.staffId ?? null,
      startTime: item.startTime,
      endTime,
      pricePaise: item.pricePaise ?? service.pricePaise,
    };
  });

  const keys = Object.keys(errors);
  if (keys.length) throw badRequest(errors[keys[0]], errors);
  return resolved;
}

/**
 * 409 when a provider would be in two places at once: against other live appointments that day
 * (excluding `excludeId`, the appointment being edited) and against earlier rows of the same request.
 */
export async function assertNoConflicts(tx, { branchId, date, items, excludeId }) {
  const staffIds = [...new Set(items.map((item) => item.staffId).filter(Boolean))];
  if (!staffIds.length) return;

  const booked = await tx.appointmentItem.findMany({
    where: {
      staffId: { in: staffIds },
      appointment: {
        branchId,
        date: fromIsoDate(date),
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    },
    select: { staffId: true, startTime: true, endTime: true },
    orderBy: { startTime: 'asc' },
  });
  const staff = await tx.staff.findMany({ where: { id: { in: staffIds } }, select: { id: true, name: true } });
  const nameOf = new Map(staff.map((s) => [s.id, s.name]));

  const errors = {};
  items.forEach((item, index) => {
    if (!item.staffId) return;
    const clash = [...booked, ...items.slice(0, index)].find(
      (other) => other.staffId === item.staffId && timesOverlap(item.startTime, item.endTime, other.startTime, other.endTime),
    );
    if (clash) errors[`items.${index}.staffId`] = `${nameOf.get(item.staffId)} is booked ${clash.startTime}–${clash.endTime}`;
  });

  const keys = Object.keys(errors);
  if (keys.length) throw conflict(errors[keys[0]], errors);
}

/** Header times span all items. */
export function appointmentSpan(items) {
  return {
    startTime: items.reduce((min, item) => (item.startTime < min ? item.startTime : min), items[0].startTime),
    endTime: items.reduce((max, item) => (item.endTime > max ? item.endTime : max), items[0].endTime),
  };
}

export function queueConfirmation(tx, { branchId, client, date, startTime, createdById }) {
  return queueTemplated(tx, {
    branchId,
    client,
    kind: 'APPOINTMENT_CONFIRMATION',
    vars: { date: formatMessageDate(date), time: startTime },
    createdById,
  });
}
