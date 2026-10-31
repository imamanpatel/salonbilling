// All money is stored and sent over the API as integer paise (1 INR = 100 paise).
// Rupee values only exist at the edges (form inputs, display), never in arithmetic.

const RUPEE_PATTERN = /^(-)?(\d+)(?:\.(\d{1,2}))?$/;

/** Parse "1,234.5" / 1234.5 into 123450 paise. Returns null for empty or invalid input. */
export function rupeesToPaise(value) {
  if (value === null || value === undefined) return null;
  const str = typeof value === 'number' ? value.toFixed(2) : String(value).replace(/,/g, '').trim();
  if (str === '') return null;
  const match = RUPEE_PATTERN.exec(str);
  if (!match) return null;
  const [, sign, whole, fraction = ''] = match;
  const paise = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return sign && paise !== 0 ? -paise : paise;
}

/** 123450 -> "1234.50", for pre-filling form inputs. */
export function paiseToRupees(paise) {
  if (paise === null || paise === undefined) return '';
  const sign = paise < 0 ? '-' : '';
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** 123450 -> "₹1,234.50" */
export function formatINR(paise) {
  return inr.format((paise ?? 0) / 100);
}

/**
 * `ratePct` percent of `paise`, rounded half away from zero to the nearest paisa.
 * Works in basis points so 2.5% or 18% never touch floating-point money.
 */
export function percentOf(paise, ratePct) {
  const basisPoints = Math.round(Number(ratePct) * 100);
  const raw = paise * basisPoints;
  return Math.sign(raw) * Math.floor((Math.abs(raw) + 5000) / 10000);
}
