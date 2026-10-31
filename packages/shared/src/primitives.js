import { z } from 'zod';

// Building blocks for request schemas. Money is integer paise; dates are "YYYY-MM-DD"; times are "HH:mm".

export const blankToNull = (v) => (v === '' || v === undefined ? null : v);

export const required = (label, max = 120) => z.string().trim().min(1, `${label} is required`).max(max);
export const optionalText = (max = 255) => z.string().trim().max(max).nullish().transform((v) => v || null);

/** "+91 98765-43210" -> "+919876543210": drop spaces, dashes, dots and brackets. */
export const normalizePhone = (value) => (typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value);

export const phone = z.preprocess(normalizePhone, z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number'));
export const optionalPhone = z.preprocess((v) => blankToNull(normalizePhone(v)), phone.nullable());
export const id = z.string().uuid();
export const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
export const optionalEmail = z.preprocess(blankToNull, z.string().trim().email('Enter a valid email').nullable());

export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
export const optionalDate = z.preprocess(blankToNull, isoDate.nullable());
export const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
export const optionalTime = z.preprocess(blankToNull, time.nullable());
/** "YYYY-MM" */
export const isoMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const paise = z
  .number({ error: (issue) => (issue.input == null ? 'Enter an amount' : 'Enter a valid amount') })
  .int('Enter a valid amount')
  .min(0, 'Cannot be negative');
export const optionalPaise = z.preprocess(blankToNull, paise.nullable());
export const percent = z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100');
export const quantity = z.coerce.number().int('Whole numbers only').min(1, 'At least 1').max(9999);
export const password = z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters');

/** Compare "HH:mm" strings: true when `a` is strictly before `b`. */
export const isBeforeTime = (a, b) => a < b;
