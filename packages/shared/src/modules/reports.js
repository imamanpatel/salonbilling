import { z } from 'zod';
import { CASH_METHODS, PAYMENT_METHODS } from '../constants.js';
import { isoDate } from '../primitives.js';

// Reports & dashboard (M8). Ranges are inclusive business dates "YYYY-MM-DD" in the branch time zone.

export const MAX_REPORT_DAYS = 366;

export const REPORTS = [
  { key: 'daily-summary', label: 'Daily summary', ranged: true },
  { key: 'sales-by-item', label: 'Sales by item', ranged: true },
  { key: 'staff', label: 'Staff performance', ranged: true },
  { key: 'collections', label: 'Collections', ranged: true },
  { key: 'dues', label: 'Dues', ranged: false },
  { key: 'clients', label: 'Clients', ranged: true },
  { key: 'enquiries', label: 'Enquiries', ranged: true },
  { key: 'profit', label: 'Profit & loss', ranged: true },
];

/** Bill item kinds that count as sales (OPENING_BALANCE lines are old dues, not sales). */
export const SALES_KINDS = ['SERVICE', 'PRODUCT', 'PACKAGE', 'MEMBERSHIP', 'GIFT_CARD'];
/** Money received in the till (bank included). */
export const COLLECTION_METHODS = CASH_METHODS;
/** Spending of earlier money (wallet balance, gift cards): shown separately, never counted as collected. */
export const REDEMPTION_METHODS = PAYMENT_METHODS.filter((m) => !CASH_METHODS.includes(m));
/** Salary kinds that are money paid out (DEDUCTION is not). */
export const PAID_SALARY_KINDS = ['SALARY', 'INCENTIVE', 'BONUS', 'ADVANCE'];

export const METHOD_LABELS = {
  CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', WALLET: 'Wallet', GIFT_CARD: 'Gift card', OTHER: 'Other',
};
export const ITEM_KIND_LABELS = { SERVICE: 'Services', PRODUCT: 'Products', PACKAGE: 'Packages', MEMBERSHIP: 'Memberships', GIFT_CARD: 'Gift cards' };
export const PAYMENT_KIND_LABELS = { BILL: 'Bill', ADVANCE: 'Advance', DUE_COLLECTION: 'Due collection', WALLET_TOPUP: 'Wallet top-up' };
export const APPOINTMENT_STATUSES = ['REQUESTED', 'BOOKED', 'CHECKED_IN', 'BILLED', 'CANCELLED', 'NO_SHOW'];

const DAY_MS = 86_400_000;
const toTime = (iso) => Date.parse(`${iso}T00:00:00Z`);
const isRealDate = (iso) => {
  const time = toTime(iso);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === iso;
};

/** Days in the inclusive range, e.g. ("2026-10-01", "2026-10-31") -> 31. */
export const rangeDays = (from, to) => Math.round((toTime(to) - toTime(from)) / DAY_MS) + 1;

/** "2026-10-31" plus `days` -> "YYYY-MM-DD". */
export const shiftIsoDate = (iso, days) => new Date(toTime(iso) + days * DAY_MS).toISOString().slice(0, 10);

const reportDate = (label) => z.string({ error: `${label} date is required` }).pipe(isoDate).refine(isRealDate, 'Enter a valid date');

export const reportRangeSchema = z
  .object({ from: reportDate('From'), to: reportDate('To') })
  .superRefine((r, ctx) => {
    // Zod keeps running object checks after field issues; only compare two real dates.
    if (!isRealDate(r.from) || !isRealDate(r.to)) return;
    if (r.to < r.from) ctx.addIssue({ code: 'custom', path: ['to'], message: 'Must be on or after the from date' });
    else if (rangeDays(r.from, r.to) > MAX_REPORT_DAYS) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: `Pick a range of at most ${MAX_REPORT_DAYS} days` });
    }
  });

export const salesByItemQuerySchema = z.object({ kind: z.enum(SALES_KINDS).optional() });
export const collectionsQuerySchema = z.object({ method: z.enum(PAYMENT_METHODS).optional() });

export const RANGE_PRESETS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'this-week', label: 'This week' },
  { value: 'this-month', label: 'This month' },
  { value: 'last-month', label: 'Last month' },
  { value: 'custom', label: 'Custom' },
];

/** `{ from, to }` for a preset relative to `today` ("YYYY-MM-DD"); weeks start on Monday. Null for "custom"/unknown. */
export function presetRange(preset, today) {
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = shiftIsoDate(today, -1);
      return { from: day, to: day };
    }
    case 'this-week': {
      const weekday = (new Date(toTime(today)).getUTCDay() + 6) % 7; // Monday = 0
      return { from: shiftIsoDate(today, -weekday), to: today };
    }
    case 'this-month':
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case 'last-month': {
      const lastDay = shiftIsoDate(`${today.slice(0, 7)}-01`, -1);
      return { from: `${lastDay.slice(0, 7)}-01`, to: lastDay };
    }
    default:
      return null;
  }
}
