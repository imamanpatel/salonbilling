import { z } from 'zod';
import {
  blankToNull, isoDate, optionalDate, optionalEmail, optionalId, optionalPaise, optionalPhone, optionalText, paise, quantity, required,
} from '../primitives.js';

// Inventory (M5): products, vendors, purchases and stock movements. Money is integer paise.

export const PRODUCT_UNITS = ['PCS', 'ML', 'L', 'G', 'KG', 'PKT'];
export const STOCK_REASONS = ['OPENING', 'PURCHASE', 'SALE', 'USAGE', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT', 'BILL_VOID'];
/** Purchase lots expiring within this many days show up in stock alerts. */
export const EXPIRY_ALERT_DAYS = 30;
export const MAX_PURCHASE_ITEMS = 200;

const pick = (label) => z.string({ error: `Pick a ${label}` }).uuid(`Pick a ${label}`);
const wholeNumber = (max = 99_999) => z.coerce.number().int('Whole numbers only').min(0, 'Cannot be negative').max(max);

export const productSchema = z
  .object({
    name: required('Product name', 120),
    brand: optionalText(80),
    barcode: optionalText(60),
    unit: z.enum(PRODUCT_UNITS).default('PCS'),
    volume: z.preprocess(blankToNull, z.coerce.number().positive('Must be more than 0').max(99_999_999).nullable()),
    mrpPaise: paise,
    salePricePaise: paise,
    costPricePaise: paise.default(0),
    rewardPoints: wholeNumber().default(0),
    lowStockAt: wholeNumber().default(5),
    isRetail: z.boolean().default(true),
    taxRateId: optionalId,
    isActive: z.boolean().default(true),
    /** Only used when creating a product: recorded as an OPENING stock movement. */
    openingStock: wholeNumber().default(0),
  })
  .refine((p) => p.salePricePaise <= p.mrpPaise, {
    path: ['salePricePaise'],
    message: 'Sale price cannot be more than the MRP',
  });

export const vendorSchema = z.object({
  name: required('Vendor name', 120),
  phone: optionalPhone,
  email: optionalEmail,
  gstin: z.preprocess(
    blankToNull,
    z.string().trim().toUpperCase().regex(/^[0-9A-Z]{15}$/, 'GSTIN must be 15 letters/digits').nullable(),
  ),
  address: optionalText(500),
  notes: optionalText(1000),
  isActive: z.boolean().default(true),
});

export const purchaseItemSchema = z.object({
  productId: pick('product'),
  qty: quantity,
  costPricePaise: paise,
  /** Blank keeps the product's current MRP. */
  mrpPaise: optionalPaise,
  lotNo: optionalText(60),
  expiresOn: optionalDate,
});

/** Subtotal = Σ qty × cost; total = subtotal − discount + tax + shipping. Ignores rows that are not numbers yet. */
export function purchaseTotals({ items = [], discountPaise = 0, taxPaise = 0, shippingPaise = 0 }) {
  const num = (v) => (Number.isInteger(v) ? v : 0);
  const subtotalPaise = items.reduce((sum, item) => sum + num(Number(item.qty)) * num(item.costPricePaise), 0);
  return { subtotalPaise, totalPaise: subtotalPaise - num(discountPaise) + num(taxPaise) + num(shippingPaise) };
}

export const purchaseSchema = z
  .object({
    vendorId: pick('vendor'),
    invoiceNo: optionalText(60),
    purchasedOn: isoDate,
    items: z.array(purchaseItemSchema).min(1, 'Add at least one item').max(MAX_PURCHASE_ITEMS, `At most ${MAX_PURCHASE_ITEMS} items`),
    discountPaise: paise.default(0),
    taxPaise: paise.default(0),
    shippingPaise: paise.default(0),
    paidPaise: paise.default(0),
    notes: optionalText(1000),
  })
  .superRefine((p, ctx) => {
    const { subtotalPaise, totalPaise } = purchaseTotals(p);
    if (p.discountPaise > subtotalPaise) {
      ctx.addIssue({ code: 'custom', path: ['discountPaise'], message: 'Discount cannot be more than the subtotal' });
    } else if (p.paidPaise > totalPaise) {
      ctx.addIssue({ code: 'custom', path: ['paidPaise'], message: 'Paid cannot be more than the total' });
    }
  });

export const purchasePaymentSchema = z.object({
  amountPaise: paise.min(1, 'Enter an amount'),
});

/** "Use product in salon": consumes stock, optionally against the staff member who used it. */
export const stockUsageSchema = z.object({
  productId: pick('product'),
  qty: quantity,
  staffId: optionalId,
  note: optionalText(255),
});

export const stockAdjustmentSchema = z.object({
  productId: pick('product'),
  qtyChange: z.coerce
    .number({ error: 'Enter a quantity' })
    .int('Whole numbers only')
    .min(-99_999)
    .max(99_999)
    .refine((v) => v !== 0, 'Enter a quantity other than 0'),
  note: required('Reason', 255),
});

export const stockTransferSchema = z
  .object({
    toBranchId: pick('branch'),
    items: z
      .array(z.object({ productId: pick('product'), qty: quantity }))
      .min(1, 'Add at least one product')
      .max(MAX_PURCHASE_ITEMS),
    note: optionalText(255),
  })
  .superRefine((t, ctx) => {
    const seen = new Set();
    t.items.forEach((item, index) => {
      if (seen.has(item.productId)) ctx.addIssue({ code: 'custom', path: ['items', index, 'productId'], message: 'Already in the list' });
      seen.add(item.productId);
    });
  });
