import { STAFF_KINDS } from '@salon/shared';
import { BOOKING_DAYS_AHEAD, fromMinutes, SLOT_STEP_MIN, toMinutes } from '@salon/shared/website';
import { addDaysIso, fromIsoDate } from '../lib/dates.js';

/** Appointments in these states occupy their provider's time. */
export const BLOCKING_STATUSES = ['REQUESTED', 'BOOKED', 'CHECKED_IN'];

/** Current wall-clock time in `timeZone` as "HH:mm". */
export const nowTimeIn = (timeZone) =>
  new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

const overlaps = (a, b) => a.start < b.end && b.start < a.end; // half-open intervals

/**
 * Online booking start times ("HH:mm") for one day. Pure: everything it needs is passed in.
 * - `providers`: [{ busy: [{ start, end }] }] — busy intervals ("HH:mm") of each active service provider.
 * - `unassigned`: [{ start, end }] — booked items without a provider yet; each one needs a free provider too.
 * A start time is offered when the whole block fits before closing, is in the future (business time), is not on a
 * holiday, and more providers are free for the whole block than unassigned items overlap it.
 */
export function availableSlots({
  date, today, nowTime, openTime, closeTime, durationMin, isHoliday = false, providers = [], unassigned = [],
  step = SLOT_STEP_MIN, daysAhead = BOOKING_DAYS_AHEAD,
}) {
  if (isHoliday || !providers.length || durationMin <= 0) return [];
  if (date < today || date > addDaysIso(today, daysAhead)) return [];

  const toRange = (r) => ({ start: toMinutes(r.start), end: toMinutes(r.end) });
  const busy = providers.map((p) => p.busy.map(toRange));
  const waiting = unassigned.map(toRange);
  const open = toMinutes(openTime);
  const close = toMinutes(closeTime);
  const earliest = date === today ? toMinutes(nowTime) + 1 : 0;

  const slots = [];
  for (let start = Math.ceil(open / step) * step; start + durationMin <= close; start += step) {
    if (start < earliest) continue;
    const block = { start, end: start + durationMin };
    const free = busy.filter((ranges) => !ranges.some((r) => overlaps(r, block))).length;
    const queued = waiting.filter((r) => overlaps(r, block)).length;
    if (free > queued) slots.push(fromMinutes(start));
  }
  return slots;
}

/**
 * Loads the day's providers, bookings and holiday for `branch` and returns the available start times
 * for a block of `durationMin` minutes. `db` may be a transaction client.
 */
export async function branchSlots(db, { branch, date, durationMin, today, nowTime }) {
  const day = fromIsoDate(date);
  const [holiday, providers, items] = await Promise.all([
    db.holiday.findUnique({ where: { branchId_date: { branchId: branch.id, date: day } }, select: { id: true } }),
    db.staff.findMany({ where: { branchId: branch.id, kind: STAFF_KINDS.SERVICE_PROVIDER, isActive: true }, select: { id: true } }),
    db.appointmentItem.findMany({
      where: { appointment: { branchId: branch.id, date: day, status: { in: BLOCKING_STATUSES } } },
      select: { staffId: true, startTime: true, endTime: true },
    }),
  ]);

  const toRange = (item) => ({ start: item.startTime, end: item.endTime });
  return availableSlots({
    date,
    today,
    nowTime,
    openTime: branch.openTime,
    closeTime: branch.closeTime,
    durationMin,
    isHoliday: Boolean(holiday),
    providers: providers.map((p) => ({ busy: items.filter((i) => i.staffId === p.id).map(toRange) })),
    unassigned: items.filter((i) => !i.staffId).map(toRange),
  });
}
