import { isoDate, isoMonth } from '@salon/shared';
import { config } from '../config.js';
import { addDaysIso, fromIsoDate, todayIso } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';
import { queryString } from '../lib/http.js';

// Date helpers for M6. Business dates/months are calendar values in config.timezone.

const tz = () => config.timezone;

/** Current business time as "HH:mm". */
export const nowTime = () =>
  new Intl.DateTimeFormat('en-GB', { timeZone: tz(), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());

/** Business calendar date of an instant, as "YYYY-MM-DD". */
export const businessDate = (date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz(), year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export const currentMonth = () => todayIso(tz()).slice(0, 7);

/** "2026-02" -> ['2026-02-01', …, '2026-02-28'] */
export function monthDays(month) {
  const [year, mon] = month.split('-').map(Number);
  const count = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return Array.from({ length: count }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`);
}

export function monthRange(month) {
  const days = monthDays(month);
  return { from: days[0], to: days.at(-1) };
}

// Offset (ms) of `timeZone` from UTC at the given instant.
function zoneOffsetMs(instant, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
      .formatToParts(instant)
      .map((p) => [p.type, p.value]),
  );
  const asUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** The instant a business day starts, e.g. "2026-10-01" in Asia/Kolkata -> 2026-09-30T18:30:00Z. */
export function businessDayStart(iso) {
  const midnightUtc = fromIsoDate(iso).getTime();
  const first = midnightUtc - zoneOffsetMs(new Date(midnightUtc), tz());
  return new Date(midnightUtc - zoneOffsetMs(new Date(first), tz()));
}

/** Prisma filter for timestamps falling on business dates `from`..`to` (inclusive). */
export const businessRange = (from, to) => ({ gte: businessDayStart(from), lt: businessDayStart(addDaysIso(to, 1)) });

const invalid = (key, message) => badRequest(message, { [key]: message });

/** `?<key>=YYYY-MM-DD`, or `fallback` when absent. */
export function dateParam(req, key, fallback) {
  const value = queryString(req, key);
  if (!value) return fallback;
  if (!isoDate.safeParse(value).success || Number.isNaN(fromIsoDate(value).getTime())) throw invalid(key, 'Use YYYY-MM-DD');
  return value;
}

/** `?month=YYYY-MM`, defaulting to the current business month. */
export function monthParam(req) {
  const value = queryString(req, 'month');
  if (!value) return currentMonth();
  if (!isoMonth.safeParse(value).success) throw invalid('month', 'Use YYYY-MM');
  return value;
}

/** `?from&to` business dates, defaulting to the current business month. */
export function rangeParams(req) {
  const { from, to } = monthRange(currentMonth());
  const range = { from: dateParam(req, 'from', from), to: dateParam(req, 'to', to) };
  if (range.from > range.to) throw invalid('to', 'End date cannot be before the start date');
  return range;
}

export const staffSummary = (staff) => ({
  id: staff.id,
  name: staff.name,
  kind: staff.kind,
  designation: staff.designation,
  department: staff.department,
  isActive: staff.isActive,
  branchId: staff.branchId,
});

export const STAFF_ORDER = [{ kind: 'asc' }, { name: 'asc' }];
