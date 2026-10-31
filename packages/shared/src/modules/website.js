import { z } from 'zod';
import { id, isoDate, optionalDate, optionalEmail, optionalText, phone, required, time } from '../primitives.js';

// M9: public booking + feedback payloads and the website admin (offers, gallery, moderation).

/** Online bookings can be made from today up to this many days ahead. */
export const BOOKING_DAYS_AHEAD = 60;
/** Online booking start times are offered every this many minutes. */
export const SLOT_STEP_MIN = 15;
export const MAX_BOOKING_SERVICES = 5;
export const MAX_GALLERY_UPLOAD = 10;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
export const FEEDBACK_STATUSES = ['pending', 'approved', 'all'];

/** Multipart form fields arrive as strings: "true"/"on"/"1" -> true, "false"/"0"/"" -> false. */
const formBoolean = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  return ['true', 'on', '1'].includes(v.trim().toLowerCase());
}, z.boolean());

const sortOrder = z.preprocess(
  (v) => (v === '' || v === null || v === undefined ? 0 : v),
  z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').max(9999),
);

const stars = (label) =>
  z.coerce
    .number({ error: `Pick a ${label}` })
    .int(`Pick a ${label}`)
    .min(1, `Pick a ${label}`)
    .max(5, 'At most 5 stars');
const optionalStars = (label) => z.preprocess((v) => (v === '' || v === undefined || v === 0 ? null : v), stars(label).nullable());

export const publicBookingSchema = z.object({
  name: required('Your name', 80),
  phone,
  email: optionalEmail,
  date: isoDate,
  time,
  serviceIds: z
    .array(id, { error: 'Pick at least one service' })
    .min(1, 'Pick at least one service')
    .max(MAX_BOOKING_SERVICES, `Pick at most ${MAX_BOOKING_SERVICES} services`),
  notes: optionalText(500),
});

export const feedbackSchema = z.object({
  rating: z.preprocess((v) => (v === '' || v === null || v === undefined ? undefined : v), stars('rating')),
  serviceRating: optionalStars('rating'),
  staffRating: optionalStars('rating'),
  ambienceRating: optionalStars('rating'),
  comment: optionalText(1000),
});

/** Offer form; sent as multipart (with an optional `image` file) or JSON. */
export const offerSchema = z.object({
  title: required('Title', 120),
  description: optionalText(1000),
  validTo: optionalDate,
  sortOrder,
  isActive: formBoolean.default(true),
  /** Drop the current image without uploading a new one. */
  removeImage: formBoolean.default(false),
});

export const galleryUploadSchema = z.object({ caption: optionalText(200) });

export const galleryPhotoSchema = z.object({ caption: optionalText(200), sortOrder });

export const feedbackModerationSchema = z.object({ isApproved: z.boolean() });

export const onlineBookingSchema = z.object({ onlineBooking: z.boolean() });

/** "Riya Sharma" -> "Riya S." for public reviews. */
export function reviewerName(name) {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Guest';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** "HH:mm" -> minutes since midnight. */
export const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Minutes since midnight -> "HH:mm". */
export const fromMinutes = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
