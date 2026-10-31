// Business-time helpers: the jobs and message dates follow config.timezone, not the server's clock.

const partsFormat = new Map();

function zonedParts(date, timeZone) {
  if (!partsFormat.has(timeZone)) {
    partsFormat.set(
      timeZone,
      new Intl.DateTimeFormat('en-CA', {
        timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
      }),
    );
  }
  return Object.fromEntries(partsFormat.get(timeZone).formatToParts(date).map((p) => [p.type, p.value]));
}

/** `{ date: "YYYY-MM-DD", time: "HH:mm", weekday: 0 (Sun) – 6 }` of `now` in `timeZone`. */
export function businessClock(now, timeZone) {
  const p = zonedParts(now, timeZone);
  const date = `${p.year}-${p.month}-${p.day}`;
  return { date, time: `${p.hour}:${p.minute}`, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
}

/** The instant a business day ("YYYY-MM-DD") starts in `timeZone`. */
export function zonedDayStart(iso, timeZone) {
  const wallAsUtc = Date.parse(`${iso}T00:00:00Z`);
  const offsetAt = (instant) => {
    const p = zonedParts(new Date(instant), timeZone);
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - instant;
  };
  let instant = wallAsUtc - offsetAt(wallAsUtc);
  instant = wallAsUtc - offsetAt(instant);
  return new Date(instant);
}

const longDate = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

/** "2026-11-01" -> "1 Nov 2026" (for messages to clients). */
export const formatMessageDate = (iso) => longDate.format(new Date(`${iso}T00:00:00Z`));

/** "16:30" -> "4:30 PM" */
export function formatMessageTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}
