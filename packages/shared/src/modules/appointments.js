import { z } from 'zod';
import { CASH_METHODS, isBeforeTime, isoDate, optionalId, optionalPaise, optionalText, optionalTime, paise, time } from '@salon/shared';

// Appointments (M3): booking calendar, status flow and advance payments.

export const APPOINTMENT_STATUSES = ['REQUESTED', 'BOOKED', 'CHECKED_IN', 'BILLED', 'CANCELLED', 'NO_SHOW'];
export const APPOINTMENT_SOURCES = ['WALK_IN', 'PHONE', 'WEBSITE', 'APP', 'OTHER'];

/** Statuses that hold a provider's time (used by the double-booking check) and can still be edited. */
export const ACTIVE_APPOINTMENT_STATUSES = ['REQUESTED', 'BOOKED', 'CHECKED_IN'];

/** Allowed manual status changes. BILLED is set only by billing and never changes afterwards. */
export const APPOINTMENT_TRANSITIONS = Object.freeze({
  REQUESTED: ['BOOKED', 'CANCELLED'],
  BOOKED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['BOOKED', 'CANCELLED'],
  BILLED: [],
  CANCELLED: ['BOOKED'],
  NO_SHOW: ['BOOKED'],
});

export const MAX_APPOINTMENT_ITEMS = 20;

/** "10:30" -> 630 */
export const timeToMinutes = (value) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
};

/** 630 -> "10:30" */
export const minutesToTime = (total) =>
  `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;

/** "10:30" + 45 -> "11:15"; null when the result would run past midnight. */
export function addMinutesToTime(value, minutes) {
  const total = timeToMinutes(value) + minutes;
  return total >= 24 * 60 ? null : minutesToTime(total);
}

/** Half-open intervals [start, end) overlap; "HH:mm" strings compare correctly as text. */
export const timesOverlap = (aStart, aEnd, bStart, bEnd) => aStart < bEnd && bStart < aEnd;

export const appointmentItemSchema = z
  .object({
    serviceId: z.string({ error: 'Pick a service' }).uuid('Pick a service'),
    /** Blank = any available provider. */
    staffId: optionalId,
    startTime: time,
    /** Blank = start + the service's duration. */
    endTime: optionalTime,
    /** Blank = the service's price. */
    pricePaise: optionalPaise,
  })
  .refine((item) => !item.endTime || isBeforeTime(item.startTime, item.endTime), {
    path: ['endTime'],
    message: 'Must be after the start time',
  });

export const appointmentAdvanceSchema = z.object({
  amountPaise: paise.min(1, 'Enter an amount'),
  method: z.enum(CASH_METHODS, { error: 'Pick a payment method' }),
  reference: optionalText(100),
});

/** PUT /appointments/:id — rescheduling replaces all items. */
export const appointmentUpdateSchema = z.object({
  clientId: z.string({ error: 'Pick a client' }).uuid('Pick a client'),
  date: isoDate,
  source: z.enum(APPOINTMENT_SOURCES).default('PHONE'),
  notes: optionalText(1000),
  items: z
    .array(appointmentItemSchema, { error: 'Add at least one service' })
    .min(1, 'Add at least one service')
    .max(MAX_APPOINTMENT_ITEMS, `At most ${MAX_APPOINTMENT_ITEMS} services per appointment`),
  notifyClient: z.boolean().default(false),
});

/** POST /appointments — optionally takes an advance payment at booking time. */
export const appointmentSchema = appointmentUpdateSchema.extend({
  advance: appointmentAdvanceSchema.nullish().transform((v) => v ?? null),
});

export const appointmentStatusSchema = z
  .object({
    status: z.enum(APPOINTMENT_STATUSES),
    cancelReason: optionalText(255),
  })
  .refine((s) => s.status !== 'CANCELLED' || s.cancelReason, {
    path: ['cancelReason'],
    message: 'Give a reason for cancelling',
  });
