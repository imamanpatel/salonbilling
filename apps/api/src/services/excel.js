/** Plain text from an exceljs cell value (formulas, rich text, hyperlinks and dates included). */
export function cellText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'object') {
    if ('result' in value) return cellText(value.result); // formula
    if ('richText' in value) return value.richText.map((part) => part.text).join('').trim();
    if ('text' in value) return String(value.text).trim(); // hyperlink
  }
  return String(value).trim();
}

/**
 * A date cell as "YYYY-MM-DD": accepts real Excel dates, "2026-10-31" and Indian "31/10/2026" (also - or .).
 * Returns '' for a blank cell and null when the text is not a valid date.
 */
export function cellDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = cellText(value);
  if (!text) return '';
  let match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (match) return validIso(match[1], match[2], match[3]);
  match = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (match) return validIso(match[3], match[2], match[1]);
  return null;
}

function validIso(year, month, day) {
  const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const date = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === iso ? iso : null;
}
