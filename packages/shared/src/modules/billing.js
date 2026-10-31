import { z } from 'zod';
import { CASH_METHODS, PAYMENT_METHODS } from '../constants.js';
import { percentOf } from '../money.js';
import { optionalId, optionalPaise, optionalText, paise, percent, quantity } from '../primitives.js';
import { MIN_GIFT_CARD_PAISE } from './catalogue.js';

// Billing math and payloads, shared by the API (authoritative) and the POS (live preview).
// All amounts are integer paise; percentages are plain numbers like 12.5.

export { DISCOUNT_TYPES, MIN_GIFT_CARD_PAISE } from './catalogue.js';

/** Item kinds that can be sold on a bill (OPENING_BALANCE rows are only created by data imports). */
export const BILL_ITEM_KINDS = ['SERVICE', 'PRODUCT', 'PACKAGE', 'MEMBERSHIP', 'GIFT_CARD'];
export const BILL_STATUSES = ['PAID', 'PARTIAL', 'VOID'];

/** Line discount in paise: PERCENT `value` is a percentage, FLAT `value` is paise (never more than the line). */
export function lineDiscountFrom(discount, grossPaise) {
  if (!discount || !(grossPaise > 0)) return 0;
  const value = Number(discount.value) || 0;
  if (value <= 0) return 0;
  if (discount.type === 'PERCENT') return Math.min(grossPaise, percentOf(grossPaise, Math.min(value, 100)));
  if (discount.type === 'FLAT') return Math.min(Math.round(value), grossPaise);
  return 0;
}

/**
 * Split an integer `totalPaise` across `weights` proportionally (largest-remainder method), so the parts always
 * add up to exactly `totalPaise`. Remainder ties go to the earlier index; all-zero weights give all zeros.
 */
export function allocate(totalPaise, weights) {
  const w = weights.map((x) => BigInt(Math.max(0, Math.trunc(Number(x) || 0))));
  const sum = w.reduce((a, b) => a + b, 0n);
  const total = Math.trunc(totalPaise);
  if (sum === 0n || total <= 0) return weights.map(() => 0);

  const t = BigInt(total);
  const parts = w.map((x) => (t * x) / sum);
  const remainders = w.map((x, index) => ({ index, rem: (t * x) % sum }));
  let left = Number(t - parts.reduce((a, b) => a + b, 0n));
  remainders.sort((a, b) => (a.rem === b.rem ? a.index - b.index : a.rem > b.rem ? -1 : 1));
  for (const { index } of remainders) {
    if (left <= 0) break;
    parts[index] += 1n;
    left -= 1;
  }
  return parts.map(Number);
}

/** Round to the nearest rupee, half up. */
export const roundToRupee = (paise) => Math.floor((paise + 50) / 100) * 100;

/**
 * Price a bill.
 * lines: [{ grossPaise, lineDiscountPaise, taxPct, noBillDiscount? }] — `noBillDiscount` lines (gift cards) get no
 * share of the bill-level discount. The bill discount is capped at the discountable net and allocated over it.
 */
export function computeBill({ lines = [], billDiscountPaise = 0, roundOff = false }) {
  const nets = lines.map((line) => {
    const gross = Math.max(0, Math.trunc(line.grossPaise) || 0);
    const disc = Math.min(gross, Math.max(0, Math.trunc(line.lineDiscountPaise) || 0));
    return { gross, disc, net: gross - disc };
  });
  const weights = nets.map((n, i) => (lines[i].noBillDiscount ? 0 : n.net));
  const discountable = weights.reduce((a, b) => a + b, 0);
  const billDiscount = Math.min(Math.max(0, Math.trunc(billDiscountPaise) || 0), discountable);
  const shares = allocate(billDiscount, weights);

  const out = nets.map((n, i) => {
    const taxablePaise = n.net - shares[i];
    const taxPaise = percentOf(taxablePaise, lines[i].taxPct || 0);
    return {
      lineDiscountPaise: n.disc,
      billDiscountPaise: shares[i],
      discountPaise: n.disc + shares[i],
      taxablePaise,
      taxPaise,
      totalPaise: taxablePaise + taxPaise,
    };
  });

  const sum = (key) => out.reduce((acc, line) => acc + line[key], 0);
  const lineTotal = sum('totalPaise');
  const roundOffPaise = roundOff ? roundToRupee(lineTotal) - lineTotal : 0;
  return {
    lines: out,
    subtotalPaise: nets.reduce((acc, n) => acc + n.gross, 0),
    discountPaise: sum('discountPaise'),
    taxPaise: sum('taxPaise'),
    roundOffPaise,
    totalPaise: lineTotal + roundOffPaise,
  };
}

/** GST is printed as equal CGST and SGST halves; an odd paisa goes to CGST. */
export function gstSplit(taxPaise) {
  const sgstPaise = Math.floor(taxPaise / 2);
  return { cgstPaise: taxPaise - sgstPaise, sgstPaise };
}

// ─── Payloads ────────────────────────────────────────────────────────────────

const discountSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('PERCENT'), value: percent }),
  z.object({ type: z.literal('FLAT'), value: paise }),
]);

/** Omitted = use the branch default tax; null = no tax. */
const taxRateRef = z.preprocess((v) => (v === '' ? null : v), z.string().uuid().nullable().optional());

const billItemSchema = z
  .object({
    kind: z.enum(BILL_ITEM_KINDS),
    refId: optionalId,
    clientPackageItemId: optionalId,
    staffId: optionalId,
    qty: quantity.default(1),
    unitPricePaise: optionalPaise,
    discount: discountSchema.nullish().transform((v) => v ?? null),
    taxRateId: taxRateRef,
  })
  .superRefine((item, ctx) => {
    const issue = (path, message) => ctx.addIssue({ code: 'custom', path: [path], message });
    if (item.kind === 'GIFT_CARD') {
      if (item.unitPricePaise == null || item.unitPricePaise < MIN_GIFT_CARD_PAISE) issue('unitPricePaise', 'Gift card value must be at least ₹1');
      if (item.qty !== 1) issue('qty', 'Sell one gift card per line');
      return;
    }
    if (item.clientPackageItemId && item.kind !== 'SERVICE') issue('clientPackageItemId', 'Only services can be redeemed from a package');
    if (!item.refId && !item.clientPackageItemId) issue('refId', 'Pick an item');
    if (item.kind === 'MEMBERSHIP' && item.qty !== 1) issue('qty', 'Sell one membership per line');
  });

const paymentLineSchema = z
  .object({
    method: z.enum(PAYMENT_METHODS, { error: 'Pick a payment method' }),
    amountPaise: paise.min(1, 'Enter an amount'),
    reference: optionalText(80),
  })
  .superRefine((p, ctx) => {
    if (p.method === 'GIFT_CARD' && !p.reference) ctx.addIssue({ code: 'custom', path: ['reference'], message: 'Enter the gift card code' });
  });

export const billSchema = z.object({
  clientId: z.string({ error: 'Pick a client' }).uuid('Pick a client'),
  appointmentId: optionalId,
  items: z.array(billItemSchema).min(1, 'Add at least one item').max(100, 'At most 100 items per bill'),
  couponCode: z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() || null : v ?? null),
    z.string().max(40).nullable(),
  ),
  manualDiscountPaise: paise.default(0),
  redeemPoints: z.coerce.number().int('Whole points only').min(0, 'Cannot be negative').default(0),
  payments: z.array(paymentLineSchema).max(10, 'At most 10 payments').default([]),
  notes: optionalText(500),
  sendReceipt: z.boolean().default(false),
});

/** Collecting (part of) a bill's due amount later. */
export const billPaymentSchema = paymentLineSchema;

export const voidBillSchema = z.object({
  reason: z.string().trim().min(1, 'Give a reason').max(300),
});

export const walletTopupSchema = z.object({
  amountPaise: paise.min(100, 'At least ₹1'),
  method: z.enum(CASH_METHODS, { error: 'Pick a payment method' }),
  reference: optionalText(80),
});

export const pointsAdjustmentSchema = z.object({
  points: z.coerce
    .number({ error: 'Enter points' })
    .int('Whole points only')
    .refine((v) => v !== 0, 'Enter points to add or remove')
    .refine((v) => Math.abs(v) <= 1_000_000, 'Too many points'),
  note: z.string().trim().min(1, 'Add a note').max(200),
});
