import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import {
  couponDiscountPaise, couponSchema, giftCardIssueSchema, membershipPlanSchema,normalizeGiftCardCode, packageSchema, randomGiftCardCode,
} from './catalogue.js';

const SERVICE_A = '3f1c2a4e-8b7d-4c1a-9e2f-6a5b4c3d2e1f';
const SERVICE_B = '4a2d3b5f-9c8e-4d2b-8f3a-7b6c5d4e3f2a';

const errorsOf = (schema, input) => fieldErrors(schema.safeParse(input).error);

describe('packageSchema', () => {
  const valid = { name: ' Bridal ', pricePaise: 500000, validityDays: '90', items: [{ serviceId: SERVICE_A, qty: '3' }] };

  it('trims, coerces and applies defaults', () => {
    expect(packageSchema.parse(valid)).toEqual({
      name: 'Bridal', description: null, pricePaise: 500000, validityDays: 90, items: [{ serviceId: SERVICE_A, qty: 3 }], isActive: true,
    });
  });

  it('rejects duplicate services, empty items and out-of-range numbers', () => {
    expect(errorsOf(packageSchema, { ...valid, items: [{ serviceId: SERVICE_A, qty: 1 }, { serviceId: SERVICE_A, qty: 2 }] })).toEqual({
      'items.1.serviceId': 'This service is already in the package',
    });
    expect(errorsOf(packageSchema, { ...valid, items: [] })).toEqual({ items: 'Add at least one service' });
    expect(errorsOf(packageSchema, { ...valid, validityDays: 0, items: [{ serviceId: SERVICE_B, qty: 101 }] })).toEqual({
      validityDays: 'At least 1 day',
      'items.0.qty': 'At most 100',
    });
  });
});

describe('membershipPlanSchema', () => {
  it('applies defaults and bounds the multiplier', () => {
    expect(membershipPlanSchema.parse({ name: 'Gold', pricePaise: 100000, durationDays: 365 })).toMatchObject({
      useMemberPrices: true, productDiscountPct: 0, packageDiscountPct: 0, pointsMultiplier: 1, rewardPoints: 0,
    });
    expect(errorsOf(membershipPlanSchema, { name: 'Gold', pricePaise: 100000, durationDays: 365, pointsMultiplier: 6, packageDiscountPct: 101 })).toEqual({
      packageDiscountPct: 'Cannot exceed 100',
      pointsMultiplier: 'At most 5×',
    });
  });
});

describe('couponSchema', () => {
  const base = { code: ' diwali-10 ', discountType: 'PERCENT', discountPct: '10', minBillPaise: 0 };

  it('uppercases the code and clears fields of the other discount type', () => {
    expect(couponSchema.parse({ ...base, discountPaise: 5000, maxDiscountPaise: 50000 })).toMatchObject({
      code: 'DIWALI-10', discountPct: 10, discountPaise: null, maxDiscountPaise: 50000,
    });
    expect(couponSchema.parse({ ...base, discountType: 'FLAT', discountPaise: 20000, maxDiscountPaise: 1 })).toMatchObject({
      discountPct: null, discountPaise: 20000, maxDiscountPaise: null,
    });
  });

  it('requires the value that matches the discount type', () => {
    expect(errorsOf(couponSchema, { ...base, discountPct: '' })).toEqual({ discountPct: 'Enter the discount percentage' });
    expect(errorsOf(couponSchema, { ...base, discountType: 'FLAT' })).toEqual({ discountPaise: 'Enter the discount amount' });
    expect(errorsOf(couponSchema, { ...base, code: 'a b' })).toEqual({ code: '3–20 letters, numbers or dashes' });
    expect(errorsOf(couponSchema, { ...base, validFrom: '2026-11-10', validTo: '2026-11-01' })).toEqual({
      validTo: 'Must be on or after the start date',
    });
  });
});

describe('gift cards', () => {
  it('validates the issue payload', () => {
    expect(giftCardIssueSchema.parse({ initialPaise: 100000, clientId: '', expiresOn: '' })).toEqual({
      initialPaise: 100000, clientId: null, expiresOn: null,
    });
    expect(errorsOf(giftCardIssueSchema, { initialPaise: 99 })).toEqual({ initialPaise: 'At least ₹1' });
  });

  it('normalizes typed codes', () => {
    expect(normalizeGiftCardCode(' abcd-efgh 2345 ')).toBe('ABCDEFGH2345');
  });

  it('generates 12-character codes without look-alike characters', () => {
    for (let i = 0; i < 50; i += 1) expect(randomGiftCardCode()).toMatch(/^[A-HJ-NP-Z2-9]{12}$/);
  });
});

describe('couponDiscountPaise', () => {
  it('applies percent caps and never exceeds the amount', () => {
    expect(couponDiscountPaise({ discountType: 'PERCENT', discountPct: 10, maxDiscountPaise: 50000 }, 1_000_000)).toBe(50000);
    expect(couponDiscountPaise({ discountType: 'PERCENT', discountPct: 12.5, maxDiscountPaise: null }, 10000)).toBe(1250);
    expect(couponDiscountPaise({ discountType: 'FLAT', discountPaise: 20000 }, 15000)).toBe(15000);
  });
});
