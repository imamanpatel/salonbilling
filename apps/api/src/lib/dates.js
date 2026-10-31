/** "2026-10-31" -> Date at UTC midnight, for @db.Date columns. */
export const fromIsoDate = (value) => (value ? new Date(`${value}T00:00:00.000Z`) : null);

/** Date from a @db.Date column -> "2026-10-31". */
export const toIsoDate = (date) => (date ? date.toISOString().slice(0, 10) : null);
