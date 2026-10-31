import { z } from 'zod';
import {
  ENQUIRY_STATUSES, ENQUIRY_TYPES, GENDERS, LEAD_SOURCES, ROLES, SERVICE_GENDERS, STAFF_KINDS, TAX_APPLIES_TO,
} from './constants.js';

// Request schemas shared by the API (authoritative validation) and the web forms (instant feedback).
// Money fields are integer paise; dates are "YYYY-MM-DD"; times are "HH:mm".

const blankToNull = (v) => (v === '' || v === undefined ? null : v);

const required = (label, max = 120) => z.string().trim().min(1, `${label} is required`).max(max);
const optionalText = (max = 255) => z.string().trim().max(max).nullish().transform((v) => v || null);

/** "+91 98765-43210" -> "+919876543210": drop spaces, dashes, dots and brackets. */
export const normalizePhone = (value) => (typeof value === 'string' ? value.replace(/[\s().-]/g, '') : value);

const phone = z.preprocess(normalizePhone, z.string().regex(/^\+?\d{10,15}$/, 'Enter a valid phone number'));
const optionalPhone = z.preprocess((v) => blankToNull(normalizePhone(v)), phone.nullable());
const optionalId = z.preprocess(blankToNull, z.string().uuid().nullable());
const optionalEmail = z.preprocess(blankToNull, z.string().trim().email('Enter a valid email').nullable());

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const optionalDate = z.preprocess(blankToNull, isoDate.nullable());
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:mm');
const optionalTime = z.preprocess(blankToNull, time.nullable());

const paise = z
  .number({ error: (issue) => (issue.input == null ? 'Enter an amount' : 'Enter a valid amount') })
  .int('Enter a valid amount')
  .min(0, 'Cannot be negative');
const percent = z.coerce.number().min(0, 'Cannot be negative').max(100, 'Cannot exceed 100');
const password = z.string().min(8, 'Use at least 8 characters').max(72, 'Use at most 72 characters');
const id = z.string().uuid();

export const statusSchema = z.object({ isActive: z.boolean() });

export const loginSchema = z.object({
  username: required('Username', 50),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: password,
});

export const branchSchema = z.object({
  name: required('Branch name', 80),
  salonName: required('Salon name', 120),
  phone: optionalPhone,
  email: optionalEmail,
  website: optionalText(200),
  gstin: z.preprocess(
    blankToNull,
    z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 letters/digits').nullable(),
  ),
  address: optionalText(500),
  openTime: time,
  closeTime: time,
  isActive: z.boolean().default(true),
});

const userBase = z.object({
  name: required('Name', 80),
  role: z.enum([ROLES.ADMIN, ROLES.USER]),
  branchIds: z
    .array(id)
    .min(1, 'Pick at least one branch')
    .transform((ids) => [...new Set(ids)]),
  isActive: z.boolean().default(true),
});

export const userCreateSchema = userBase.extend({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9._-]{3,50}$/, '3–50 characters: letters, numbers, dot, dash, underscore'),
  password,
});

/** Leave `password` blank to keep the current one. */
export const userUpdateSchema = userBase.extend({
  password: z.preprocess((v) => (v === '' || v === null ? undefined : v), password.optional()),
});

export const staffSchema = z.object({
  kind: z.enum([STAFF_KINDS.SERVICE_PROVIDER, STAFF_KINDS.STAFF]),
  name: required('Name', 80),
  phone,
  email: optionalEmail,
  gender: z.enum(GENDERS),
  dob: optionalDate,
  joinedOn: isoDate,
  address: optionalText(500),
  emergencyName: optionalText(80),
  emergencyPhone: optionalPhone,
  monthlySalaryPaise: paise,
  shiftStart: optionalTime,
  shiftEnd: optionalTime,
  serviceCommissionPct: percent.default(0),
  productCommissionPct: percent.default(0),
  designation: optionalText(80),
  department: optionalText(40),
  attendanceCode: optionalText(40),
  isActive: z.boolean().default(true),
});

export const categorySchema = z.object({
  name: required('Category name', 80),
});

export const serviceSchema = z
  .object({
    categoryId: z.string({ error: 'Pick a category' }).uuid('Pick a category'),
    name: required('Service name', 120),
    gender: z.enum(SERVICE_GENDERS),
    durationMin: z.coerce.number().int('Whole minutes only').min(5, 'At least 5 minutes').max(720, 'At most 12 hours'),
    pricePaise: paise,
    memberPricePaise: paise,
    rewardPoints: z.coerce.number().int().min(0, 'Cannot be negative').default(0),
    showOnWebsite: z.boolean().default(true),
    isActive: z.boolean().default(true),
  })
  .refine((s) => s.memberPricePaise <= s.pricePaise, {
    path: ['memberPricePaise'],
    message: 'Member price cannot be more than the regular price',
  });

export const taxSchema = z.object({
  name: required('Tax name', 60),
  ratePct: percent,
  appliesTo: z.enum(TAX_APPLIES_TO),
  isActive: z.boolean().default(true),
});

export const settingsSchema = z.object({
  autoBirthday: z.boolean(),
  autoAnniversary: z.boolean(),
  autoAppointment: z.boolean(),
  autoPendingPayment: z.boolean(),
  autoPackageExpiry: z.boolean(),
  redeemPoints: z.coerce.number().int().min(1, 'At least 1 point'),
  redeemValuePaise: paise,
  maxRedeemPoints: z.coerce.number().int().min(0, 'Cannot be negative'),
});

export const holidaySchema = z.object({
  date: isoDate,
  description: required('Description', 120),
});

export const clientSchema = z.object({
  name: required('Client name', 80),
  phone,
  email: optionalEmail,
  gender: z.enum(GENDERS),
  dob: optionalDate,
  anniversary: optionalDate,
  address: optionalText(500),
  source: z.preprocess(blankToNull, z.enum(LEAD_SOURCES).nullable()),
  assignedToId: optionalId,
  notes: optionalText(1000),
});

export const clientFollowUpSchema = z.object({
  dueOn: isoDate,
  dueTime: optionalTime,
  note: required('Note', 500),
});

export const enquirySchema = z.object({
  name: required('Name', 80),
  phone,
  email: optionalEmail,
  address: optionalText(500),
  enquiryFor: required('Enquiry for', 200),
  type: z.enum(ENQUIRY_TYPES),
  source: z.enum(LEAD_SOURCES),
  status: z.enum(ENQUIRY_STATUSES).default('PENDING'),
  followUpOn: optionalDate,
  assignedToId: optionalId,
  notes: optionalText(1000),
});

/** Enquiries don't capture gender, so it is asked for when the lead becomes a client. */
export const convertEnquirySchema = z.object({
  gender: z.enum(GENDERS),
});

/** A logged conversation with a lead; optionally reschedules or closes it. */
export const enquiryResponseSchema = z.object({
  note: required('Response', 500),
  nextFollowUpOn: optionalDate,
  status: z.preprocess(blankToNull, z.enum(['PENDING', 'CLOSED']).nullable()),
});

/** Flatten a ZodError into `{ fieldName: firstMessage }` for forms and API error details. */
export function fieldErrors(zodError) {
  const out = {};
  for (const issue of zodError.issues) {
    const key = issue.path.join('.') || '_form';
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
