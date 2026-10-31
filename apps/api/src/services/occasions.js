import { Prisma } from '@prisma/client';
import { addDaysIso, toIsoDate } from '../lib/dates.js';

const isLeapYear = (year) => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

/**
 * `[["MM-DD", daysFromStart], ...]` for `days` days starting at `fromIso`.
 * People born on Feb 29 are celebrated on Feb 28 in non-leap years.
 */
export function monthDayWindow(fromIso, days) {
  const window = [];
  for (let offset = 0; offset < days; offset += 1) {
    const iso = addDaysIso(fromIso, offset);
    const key = iso.slice(5);
    window.push([key, offset]);
    if (key === '02-28' && !isLeapYear(Number(iso.slice(0, 4)))) window.push(['02-29', offset]);
  }
  return window;
}

const COLUMNS = { dob: Prisma.raw('"dob"'), anniversary: Prisma.raw('"anniversary"') };

/** Clients whose birthday or anniversary (`field`) falls within `days` days from `fromIso`, soonest first. */
export async function upcomingOccasions(prisma, organizationId, field, fromIso, days) {
  const window = new Map(monthDayWindow(fromIso, days));
  const column = COLUMNS[field];
  const rows = await prisma.$queryRaw`
    SELECT "id", "name", "phone", ${column} AS "date"
    FROM "Client"
    WHERE "organizationId" = ${organizationId}
      AND to_char(${column}, 'MM-DD') IN (${Prisma.join([...window.keys()])})`;

  return rows
    .map((row) => {
      const date = toIsoDate(row.date);
      return { id: row.id, name: row.name, phone: row.phone, date, inDays: window.get(date.slice(5)) };
    })
    .sort((a, b) => a.inDays - b.inDays || a.name.localeCompare(b.name));
}
