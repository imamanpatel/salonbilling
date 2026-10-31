import { todayIso } from '../../lib/format.js';

export const ATTENDANCE_LABELS = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', LEAVE: 'Leave' };
export const ATTENDANCE_SHORT = { PRESENT: 'P', HALF_DAY: 'H', ABSENT: 'A', LEAVE: 'L' };
/** Filled colours for the selected status button and month-grid cells. */
export const ATTENDANCE_TONES = {
  PRESENT: 'bg-emerald-500 text-white',
  HALF_DAY: 'bg-amber-400 text-amber-950',
  ABSENT: 'bg-rose-500 text-white',
  LEAVE: 'bg-sky-500 text-white',
};

export const SALARY_KIND_LABELS = { SALARY: 'Salary', ADVANCE: 'Advance', INCENTIVE: 'Incentive', BONUS: 'Bonus', DEDUCTION: 'Deduction' };
export const SALARY_KIND_TONES = { SALARY: 'green', ADVANCE: 'amber', INCENTIVE: 'brand', BONUS: 'blue', DEDUCTION: 'rose' };

export const METHOD_LABELS = { CASH: 'Cash', CARD: 'Card', UPI: 'UPI', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', OTHER: 'Other' };

/** Current month as "YYYY-MM". */
export const thisMonth = () => todayIso().slice(0, 7);

/** "2026-02" -> { from: "2026-02-01", to: "2026-02-28" } */
export function monthBounds(month) {
  const [year, mon] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(lastDay).padStart(2, '0')}` };
}

const monthFormat = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** "2026-10" -> "October 2026" */
export const formatMonth = (month) => (month ? monthFormat.format(new Date(`${month}-01T00:00:00Z`)) : '—');
