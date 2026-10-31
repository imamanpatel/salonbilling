import { rupeesToPaise } from '@salon/shared';

export const ROLE_LABELS = { SUPERADMIN: 'Superadmin', ADMIN: 'Admin', USER: 'Front desk' };
export const GENDER_LABELS = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };
export const SERVICE_GENDER_LABELS = { FEMALE: 'Female', MALE: 'Male', UNISEX: 'Unisex' };
export const TAX_APPLIES_LABELS = { SERVICE: 'Services', PRODUCT: 'Products', ALL: 'Everything' };

const dateFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const dateTimeFormat = new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/** "2026-10-31" -> "31 Oct 2026" */
export const formatDate = (iso) => (iso ? dateFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');

/** Today's local date as "YYYY-MM-DD", for date input defaults. */
export const todayIso = () => new Date().toLocaleDateString('en-CA');

/** ISO timestamp -> local date and time. */
export const formatDateTime = (iso) => (iso ? dateTimeFormat.format(new Date(iso)) : '—');

/**
 * Rupee form input -> paise for the API. Blank becomes null ("Enter an amount");
 * unparseable text is passed through so validation reports "Enter a valid amount".
 */
export function moneyInput(value) {
  if (value === '' || value === null || value === undefined) return null;
  return rupeesToPaise(value) ?? String(value);
}
