/** "2026-10-31" -> Date at UTC midnight, for @db.Date columns. */
export const fromIsoDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

/** Date from a @db.Date column -> "2026-10-31". */
export const toIsoDate = (date) => (date ? date.toISOString().slice(0, 10) : null);

/** Today's calendar date in `timeZone`, as "YYYY-MM-DD". */
export const todayIso = (timeZone) =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** "2026-10-31" plus `days` (may be negative) -> "YYYY-MM-DD". */
export const addDaysIso = (iso, days) => toIsoDate(new Date(fromIsoDate(iso).getTime() + days * 86_400_000));
