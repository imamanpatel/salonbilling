import { z } from 'zod';
import { percentOf } from '../money.js';
import { blankToNull, optionalDate, optionalId, optionalPaise, optionalText, paise, percent, required } from '../primitives.js';

// Catalogue extras (M4): packages, membership plans, coupons and gift cards.
// Money is integer paise; dates are "YYYY-MM-DD".

export const DISCOUNT_TYPES = ['PERCENT', 'FLAT'];

/** Gift card codes avoid look-alike characters (no 0/O, 1/I). */
export const GIFT_CARD_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const GIFT_CARD_CODE_LENGTH = 12;
export const MIN_GIFT_CARD_PAISE = 100;

/** A random 12-character gift card code. The alphabet has 32 characters, so `byte & 31` is unbiased. */
export function randomGiftCardCode() {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(GIFT_CARD_CODE_LENGTH));
  return Array.from(bytes, (b) => GIFT_CARD_CODE_ALPHABET[b & 31]).join('');
}

/** " abcd-efgh 2345 " -> "ABCDEFGH2345", for gift card lookups typed by hand. */
export const normalizeGiftCardCode = (value) => (typeof value === 'string' ? value.replace(/[\s-]/g, '').toUpperCase() : '');

const days = z.coerce.number().int('Whole days only').min(1, 'At least 1 day').max(3650, 'At most 10 years');
const wholeNumber = z.coerce.number().int('Whole numbers only');
const optionalLimit = z.preprocess(blankToNull, wholeNumber.min(1, 'At least 1').max(100_000).nullable());

export const packageItemSchema = z.object({
  serviceId: z.string({ error: 'Pick a service' }).uuid('Pick a service'),
  qty: wholeNumber.min(1, 'At least 1').max(100, 'At most 100'),
});

export const packageSchema = z
  .object({
    name: required('Package name', 120),
    description: optionalText(500),
    pricePaise: paise,
    validityDays: days,
    items: z.array(packageItemSchema, { error: 'Add at least one service' }).min(1, 'Add at least one service').max(30, 'At most 30 services'),
    isActive: z.boolean().default(true),
  })
  .superRefine((pkg, ctx) => {
    const seen = new Set();
    pkg.items.forEach((item, index) => {
      if (seen.has(item.serviceId)) {
        ctx.addIssue({ code: 'custom', path: ['items', index, 'serviceId'], message: 'This service is already in the package' });
      }
      seen.add(item.serviceId);
    });
  });

export const membershipPlanSchema = z.object({
  name: required('Plan name', 120),
  description: optionalText(500),
  pricePaise: paise,
  durationDays: days,
  useMemberPrices: z.boolean().default(true),
  productDiscountPct: percent.default(0),
  packageDiscountPct: percent.default(0),
  pointsMultiplier: wholeNumber.min(1, 'At least 1×').max(5, 'At most 5×').default(1),
  rewardPoints: wholeNumber.min(0, 'Cannot be negative').max(1_000_000).default(0),
  isActive: z.boolean().default(true),
});

export const couponSchema = z
  .object({
    code: z
      .string({ error: 'Enter a code' })
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{3,20}$/, '3–20 letters, numbers or dashes'),
    description: optionalText(255),
    discountType: z.enum(DISCOUNT_TYPES, { error: 'Pick a discount type' }),
    /** PERCENT coupons only. */
    discountPct: z.preprocess(
      blankToNull,
      z.coerce.number({ error: 'Enter a percentage' }).min(0.01, 'At least 0.01%').max(100, 'Cannot exceed 100').nullable(),
    ),
    /** FLAT coupons only. */
    discountPaise: optionalPaise,
    minBillPaise: paise.default(0),
    /** Caps a PERCENT discount; blank means no cap. */
    maxDiscountPaise: optionalPaise,
    validFrom: optionalDate,
    validTo: optionalDate,
    usageLimitPerClient: optionalLimit,
    totalUsageLimit: optionalLimit,
    isActive: z.boolean().default(true),
  })
  .superRefine((c, ctx) => {
    const issue = (field, message) => ctx.addIssue({ code: 'custom', path: [field], message });
    if (c.discountType === 'PERCENT' && c.discountPct == null) issue('discountPct', 'Enter the discount percentage');
    if (c.discountType === 'PERCENT' && c.maxDiscountPaise === 0) issue('maxDiscountPaise', 'Leave blank for no cap');
    if (c.discountType === 'FLAT' && c.discountPaise == null) issue('discountPaise', 'Enter the discount amount');
    if (c.discountType === 'FLAT' && c.discountPaise === 0) issue('discountPaise', 'Must be more than zero');
    if (c.validFrom && c.validTo && c.validTo < c.validFrom) issue('validTo', 'Must be on or after the start date');
  })
  .transform((c) =>
    c.discountType === 'PERCENT' ? { ...c, discountPaise: null } : { ...c, discountPct: null, maxDiscountPaise: null },
  );

export const giftCardIssueSchema = z.object({
  initialPaise: paise.min(MIN_GIFT_CARD_PAISE, 'At least ₹1'),
  clientId: optionalId,
  expiresOn: optionalDate,
});

/** Discount a coupon gives on `amountPaise` (before checking dates/limits/min bill), capped at the amount. */
export function couponDiscountPaise(coupon, amountPaise) {
  if (coupon.discountType === 'FLAT') return Math.min(coupon.discountPaise ?? 0, amountPaise);
  let discount = percentOf(amountPaise, coupon.discountPct ?? 0);
  if (coupon.maxDiscountPaise != null) discount = Math.min(discount, coupon.maxDiscountPaise);
  return Math.min(discount, amountPaise);
}
