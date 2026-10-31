import { z } from 'zod';
import { CASH_METHODS } from '../constants.js';
import { isoDate, isoMonth, optionalText, optionalTime, paise, required } from '../primitives.js';

// M6 Team & expenses: attendance, salary entries, expenses and staff transfers.

export const ATTENDANCE_STATUSES = ['PRESENT', 'HALF_DAY', 'ABSENT', 'LEAVE'];
export const SALARY_KINDS = ['SALARY', 'ADVANCE', 'INCENTIVE', 'BONUS', 'DEDUCTION'];
export const DEFAULT_EXPENSE_CATEGORIES = ['Rent', 'Electricity', 'Water', 'Salaries', 'Products', 'Maintenance', 'Marketing', 'Tea & snacks', 'Other'];

const staffId = z.string({ error: 'Pick a staff member' }).uuid('Pick a staff member');
const amount = paise.min(1, 'Enter an amount');
const cashMethod = z.enum(CASH_METHODS, { error: 'Pick a payment method' });

export const attendanceSchema = z
  .object({
    staffId,
    date: isoDate,
    status: z.enum(ATTENDANCE_STATUSES, { error: 'Pick a status' }),
    checkIn: optionalTime,
    checkOut: optionalTime,
    note: optionalText(255),
  })
  .superRefine((a, ctx) => {
    if (a.checkOut && !a.checkIn) ctx.addIssue({ code: 'custom', path: ['checkIn'], message: 'Enter the check-in time first' });
    else if (a.checkOut && a.checkOut < a.checkIn) ctx.addIssue({ code: 'custom', path: ['checkOut'], message: 'Cannot be before check-in' });
  });

/** POST /attendance/check-in and /attendance/check-out */
export const attendanceClockSchema = z.object({ staffId });

export const salaryEntrySchema = z.object({
  staffId,
  kind: z.enum(SALARY_KINDS, { error: 'Pick a type' }),
  forMonth: isoMonth,
  amountPaise: amount,
  method: cashMethod,
  paidOn: isoDate,
  note: optionalText(255),
});

export const expenseSchema = z.object({
  spentOn: isoDate,
  category: required('Category', 60),
  amountPaise: amount,
  method: cashMethod,
  paidTo: optionalText(120),
  description: optionalText(500),
});

export const staffTransferSchema = z.object({
  toBranchId: z.string({ error: 'Pick a branch' }).uuid('Pick a branch'),
});

/** suggested payable = salary + incentives + bonus + commission − advances − deductions − salary already paid (never below 0). */
export function suggestedPayable({ monthlySalaryPaise, commissionPaise, totalsByKind }) {
  const t = totalsByKind;
  const due = monthlySalaryPaise + t.INCENTIVE + t.BONUS + commissionPaise - t.ADVANCE - t.DEDUCTION - t.SALARY;
  return Math.max(0, due);
}
