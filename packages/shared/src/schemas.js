import { z } from 'zod';
import {
  ENQUIRY_STATUSES, ENQUIRY_TYPES, GENDERS, LEAD_SOURCES, ROLES, SERVICE_GENDERS, STAFF_KINDS, TAX_APPLIES_TO,
} from './constants.js';
import {
  blankToNull, id, isoDate, optionalDate, optionalEmail, optionalId, optionalPhone, optionalText, optionalTime, paise, password,
  percent, phone, required, time,
} from './primitives.js';

// Request schemas shared by the API (authoritative validation) and the web forms (instant feedback).
// Money fields are integer paise; dates are "YYYY-MM-DD"; times are "HH:mm".

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
  /** Public booking/feedback URL segment, e.g. "andheri". Omit to leave unchanged. */
  slug: z
    .preprocess(
      (v) => (typeof v === 'string' ? blankToNull(v.trim().toLowerCase()) : v),
      z.string().max(40).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Lowercase letters, numbers and dashes').nullable(),
    )
    .optional(),
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
  // Billing & website preferences (M4/M9). Optional so older clients can keep sending only the fields above.
  defaultServiceTaxId: optionalId.optional(),
  defaultProductTaxId: optionalId.optional(),
  billPrefix: z
    .preprocess(blankToNull, z.string().trim().toUpperCase().regex(/^[A-Z0-9]{1,8}$/, 'Up to 8 letters/digits').nullable())
    .optional(),
  roundOffBills: z.boolean().optional(),
  onlineBooking: z.boolean().optional(),
  feedbackRequests: z.boolean().optional(),
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
