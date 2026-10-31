import { rupeesToPaise } from '@salon/shared';

export const ROLE_LABELS = { SUPERADMIN: 'Superadmin', ADMIN: 'Admin', USER: 'Front desk' };
export const GENDER_LABELS = { FEMALE: 'Female', MALE: 'Male', OTHER: 'Other' };
export const SERVICE_GENDER_LABELS = { FEMALE: 'Female', MALE: 'Male', UNISEX: 'Unisex' };
export const TAX_APPLIES_LABELS = { SERVICE: 'Services', PRODUCT: 'Products', ALL: 'Everything' };
export const LEAD_SOURCE_LABELS = {
  WALK_IN: 'Walk-in', REFERRAL: 'Referral', PHONE: 'Phone call', INSTAGRAM: 'Instagram', FACEBOOK: 'Facebook',
  GOOGLE: 'Google', WEBSITE: 'Website', JUSTDIAL: 'JustDial', OTHER: 'Other',
};
export const ENQUIRY_TYPE_LABELS = { HOT: 'Hot', WARM: 'Warm', COLD: 'Cold' };
export const ENQUIRY_STATUS_LABELS = { PENDING: 'Open', CONVERTED: 'Converted', CLOSED: 'Closed' };

/** WhatsApp click-to-chat link; 10-digit numbers are assumed to be Indian (+91). */
export function whatsappLink(phone, text = '') {
  const digits = phone.replace(/\D/g, '');
  const international = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${international}${text ? `?text=${encodeURIComponent(text)}` : ''}`;
}

const dayMonthFormat = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** "1994-02-14" -> "14 Feb" (for birthdays, where the year is not the point). */
export const formatDayMonth = (iso) => (iso ? dayMonthFormat.format(new Date(`${iso.slice(0, 10)}T00:00:00Z`)) : '—');

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
