import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import { attendanceSchema, expenseSchema, salaryEntrySchema, suggestedPayable } from './hr.js';

const STAFF = '7b0c3f1e-1d2a-4c1b-9a51-1f0f6f3f2a10';

describe('attendanceSchema', () => {
  it('accepts a day with times and blanks', () => {
    const parsed = attendanceSchema.parse({ staffId: STAFF, date: '2026-10-31', status: 'PRESENT', checkIn: '10:00', checkOut: '', note: '' });
    expect(parsed).toMatchObject({ checkIn: '10:00', checkOut: null, note: null });
  });

  it('rejects check-out before check-in, or without one', () => {
    const early = attendanceSchema.safeParse({ staffId: STAFF, date: '2026-10-31', status: 'PRESENT', checkIn: '10:00', checkOut: '09:59' });
    expect(fieldErrors(early.error)).toEqual({ checkOut: 'Cannot be before check-in' });
    const orphan = attendanceSchema.safeParse({ staffId: STAFF, date: '2026-10-31', status: 'PRESENT', checkOut: '18:00' });
    expect(fieldErrors(orphan.error)).toEqual({ checkIn: 'Enter the check-in time first' });
  });
});

describe('salary and expense schemas', () => {
  it('requires a positive amount and a cash method', () => {
    const res = salaryEntrySchema.safeParse({ staffId: STAFF, kind: 'SALARY', forMonth: '2026-10', amountPaise: 0, method: 'WALLET', paidOn: '2026-10-31' });
    expect(Object.keys(fieldErrors(res.error)).sort()).toEqual(['amountPaise', 'method']);
  });

  it('limits the expense category to 60 characters', () => {
    const res = expenseSchema.safeParse({ spentOn: '2026-10-31', category: 'x'.repeat(61), amountPaise: 100, method: 'CASH' });
    expect(fieldErrors(res.error)).toHaveProperty('category');
  });
});

describe('suggestedPayable', () => {
  const totals = { SALARY: 0, ADVANCE: 0, INCENTIVE: 0, BONUS: 0, DEDUCTION: 0 };
  it('adds earnings and subtracts advances, deductions and salary paid', () => {
    const value = suggestedPayable({
      monthlySalaryPaise: 2_000_000,
      commissionPaise: 6_000,
      totalsByKind: { ...totals, SALARY: 1_000_000, ADVANCE: 300_000, INCENTIVE: 50_000, BONUS: 10_000, DEDUCTION: 5_000 },
    });
    expect(value).toBe(761_000);
  });

  it('never goes below zero', () => {
    expect(suggestedPayable({ monthlySalaryPaise: 100, commissionPaise: 0, totalsByKind: { ...totals, ADVANCE: 500 } })).toBe(0);
  });
});
