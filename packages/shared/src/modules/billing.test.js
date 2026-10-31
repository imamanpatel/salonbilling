import { describe, expect, it } from 'vitest';
import {
  allocate, billPaymentSchema, billSchema, computeBill, gstSplit, lineDiscountFrom, pointsAdjustmentSchema, roundToRupee,
  voidBillSchema, walletTopupSchema,
} from './billing.js';

const UUID = '7f1c3a52-9d4e-4b8a-a1f2-3c4d5e6f7a8b';
const sum = (xs) => xs.reduce((a, b) => a + b, 0);

describe('lineDiscountFrom', () => {
  it('computes percent discounts with paisa rounding', () => {
    expect(lineDiscountFrom({ type: 'PERCENT', value: 10 }, 50000)).toBe(5000);
    expect(lineDiscountFrom({ type: 'PERCENT', value: 12.5 }, 999)).toBe(125); // 124.875 -> 125
    expect(lineDiscountFrom({ type: 'PERCENT', value: 100 }, 777)).toBe(777);
  });

  it('caps flat discounts at the line amount', () => {
    expect(lineDiscountFrom({ type: 'FLAT', value: 2000 }, 50000)).toBe(2000);
    expect(lineDiscountFrom({ type: 'FLAT', value: 90000 }, 50000)).toBe(50000);
  });

  it('returns 0 without a discount or a line amount', () => {
    expect(lineDiscountFrom(null, 50000)).toBe(0);
    expect(lineDiscountFrom(undefined, 50000)).toBe(0);
    expect(lineDiscountFrom({ type: 'FLAT', value: 100 }, 0)).toBe(0);
    expect(lineDiscountFrom({ type: 'PERCENT', value: 0 }, 1000)).toBe(0);
  });
});

describe('allocate', () => {
  it('splits proportionally and sums exactly', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(1000, [50000, 250000])).toEqual([167, 833]);
    expect(allocate(1, [5, 5])).toEqual([1, 0]);
  });

  it('gives remainders to the largest fractions first', () => {
    // exact shares 1.4, 2.8, 2.8 -> floors 1, 2, 2 (5) -> remainders .4 .8 .8 -> +1 to index 1 (tie broken by index)
    expect(allocate(7, [1, 2, 2])).toEqual([1, 3, 3]);
    // exact 0.9, 2.1, 4.0 -> floors 0, 2, 4 -> the one left over goes to index 0 (.9)
    expect(allocate(7, [9, 21, 40])).toEqual([1, 2, 4]);
    expect(allocate(10, [1, 1, 4])).toEqual([2, 2, 6]);
  });

  it('breaks ties toward the earlier index', () => {
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
    expect(allocate(5, [1, 1, 1, 1])).toEqual([2, 1, 1, 1]);
  });

  it('handles zero weights and zero totals', () => {
    expect(allocate(500, [0, 0])).toEqual([0, 0]);
    expect(allocate(0, [3, 4])).toEqual([0, 0]);
    expect(allocate(500, [0, 10])).toEqual([0, 500]);
    expect(allocate(500, [])).toEqual([]);
  });

  it('always sums exactly for awkward inputs', () => {
    const cases = [
      [99_999, [33_333, 33_333, 33_334]],
      [12_345, [1, 7, 13, 101, 997]],
      [987_654_321, [123_456_789, 987_654_321, 1]],
      [3, [1_000_000_000, 1_000_000_000, 1_000_000_000, 1_000_000_000]],
    ];
    for (const [total, weights] of cases) {
      const parts = allocate(total, weights);
      expect(sum(parts)).toBe(total);
      parts.forEach((p) => expect(Number.isInteger(p) && p >= 0).toBe(true));
    }
  });
});

describe('computeBill', () => {
  it('handles a bill with no lines', () => {
    expect(computeBill({ lines: [], billDiscountPaise: 500, roundOff: true })).toEqual({
      lines: [], subtotalPaise: 0, discountPaise: 0, taxPaise: 0, roundOffPaise: 0, totalPaise: 0,
    });
  });

  it('adds tax per line', () => {
    const bill = computeBill({ lines: [{ grossPaise: 50000, lineDiscountPaise: 0, taxPct: 18 }] });
    expect(bill).toMatchObject({ subtotalPaise: 50000, discountPaise: 0, taxPaise: 9000, roundOffPaise: 0, totalPaise: 59000 });
    expect(bill.lines[0]).toMatchObject({ taxablePaise: 50000, taxPaise: 9000, totalPaise: 59000 });
  });

  it('rounds tax per line to the paisa and the total to the rupee', () => {
    const bill = computeBill({ lines: [{ grossPaise: 49999, lineDiscountPaise: 0, taxPct: 18 }], roundOff: true });
    // 49999 * 18% = 8999.82 -> 9000; 58999 -> 59000 (+1)
    expect(bill.taxPaise).toBe(9000);
    expect(bill.roundOffPaise).toBe(1);
    expect(bill.totalPaise).toBe(59000);
  });

  it('rounds half up and can round down', () => {
    expect(computeBill({ lines: [{ grossPaise: 10050, taxPct: 0 }], roundOff: true }).roundOffPaise).toBe(50);
    expect(computeBill({ lines: [{ grossPaise: 10049, taxPct: 0 }], roundOff: true }).roundOffPaise).toBe(-49);
    expect(roundToRupee(150)).toBe(200);
    expect(roundToRupee(149)).toBe(100);
  });

  it('applies line discounts before the bill discount and tax', () => {
    const bill = computeBill({
      lines: [
        { grossPaise: 100000, lineDiscountPaise: 10000, taxPct: 18 },
        { grossPaise: 30000, lineDiscountPaise: 0, taxPct: 5 },
      ],
      billDiscountPaise: 12000,
    });
    // nets 90000 / 30000 -> bill discount split 9000 / 3000
    expect(bill.lines[0]).toMatchObject({ lineDiscountPaise: 10000, billDiscountPaise: 9000, discountPaise: 19000, taxablePaise: 81000, taxPaise: 14580 });
    expect(bill.lines[1]).toMatchObject({ billDiscountPaise: 3000, taxablePaise: 27000, taxPaise: 1350 });
    expect(bill.subtotalPaise).toBe(130000);
    expect(bill.discountPaise).toBe(22000);
    expect(bill.taxPaise).toBe(15930);
    expect(bill.totalPaise).toBe(81000 + 14580 + 27000 + 1350);
  });

  it('caps discounts that exceed the net amount', () => {
    const bill = computeBill({
      lines: [{ grossPaise: 1000, lineDiscountPaise: 5000, taxPct: 18 }, { grossPaise: 2000, lineDiscountPaise: 0, taxPct: 18 }],
      billDiscountPaise: 99999,
    });
    expect(bill.lines[0]).toMatchObject({ lineDiscountPaise: 1000, billDiscountPaise: 0, taxablePaise: 0, totalPaise: 0 });
    expect(bill.lines[1]).toMatchObject({ billDiscountPaise: 2000, taxablePaise: 0 });
    expect(bill.discountPaise).toBe(3000);
    expect(bill.totalPaise).toBe(0);
  });

  it('keeps bill discounts off lines marked noBillDiscount', () => {
    const bill = computeBill({
      lines: [{ grossPaise: 100000, taxPct: 0, noBillDiscount: true }, { grossPaise: 20000, taxPct: 18 }],
      billDiscountPaise: 50000,
    });
    expect(bill.lines[0].billDiscountPaise).toBe(0);
    expect(bill.lines[1].billDiscountPaise).toBe(20000);
    expect(bill.totalPaise).toBe(100000);
  });

  it('keeps totals consistent across mixed tax rates and odd amounts', () => {
    const lines = [
      { grossPaise: 33333, lineDiscountPaise: 333, taxPct: 18 },
      { grossPaise: 12345, lineDiscountPaise: 0, taxPct: 5 },
      { grossPaise: 7777, lineDiscountPaise: 77, taxPct: 12.5 },
      { grossPaise: 0, lineDiscountPaise: 0, taxPct: 18 },
    ];
    const bill = computeBill({ lines, billDiscountPaise: 1001, roundOff: true });
    const shares = bill.lines.map((l) => l.billDiscountPaise);
    expect(sum(shares)).toBe(1001);
    expect(bill.discountPaise).toBe(333 + 77 + 1001);
    expect(bill.taxPaise).toBe(sum(bill.lines.map((l) => l.taxPaise)));
    expect(bill.subtotalPaise - bill.discountPaise + bill.taxPaise + bill.roundOffPaise).toBe(bill.totalPaise);
    expect(bill.totalPaise % 100).toBe(0);
    bill.lines.forEach((l) => expect(l.totalPaise).toBe(l.taxablePaise + l.taxPaise));
  });
});

describe('gstSplit', () => {
  it('halves tax with the odd paisa on CGST', () => {
    expect(gstSplit(9000)).toEqual({ cgstPaise: 4500, sgstPaise: 4500 });
    expect(gstSplit(9001)).toEqual({ cgstPaise: 4501, sgstPaise: 4500 });
    expect(gstSplit(0)).toEqual({ cgstPaise: 0, sgstPaise: 0 });
  });
});

describe('billSchema', () => {
  const base = { clientId: UUID, items: [{ kind: 'SERVICE', refId: UUID }] };

  it('fills defaults', () => {
    const parsed = billSchema.parse(base);
    expect(parsed).toMatchObject({ manualDiscountPaise: 0, redeemPoints: 0, payments: [], sendReceipt: false, couponCode: null });
    expect(parsed.items[0]).toMatchObject({ qty: 1, discount: null, staffId: null, unitPricePaise: null });
    expect('taxRateId' in parsed.items[0] ? parsed.items[0].taxRateId : undefined).toBeUndefined();
  });

  it('keeps an explicit "no tax" apart from "use the default"', () => {
    expect(billSchema.parse({ ...base, items: [{ ...base.items[0], taxRateId: null }] }).items[0].taxRateId).toBeNull();
    expect(billSchema.parse({ ...base, items: [{ ...base.items[0], taxRateId: '' }] }).items[0].taxRateId).toBeNull();
  });

  it('upper-cases coupon codes', () => {
    expect(billSchema.parse({ ...base, couponCode: ' diwali10 ' }).couponCode).toBe('DIWALI10');
    expect(billSchema.parse({ ...base, couponCode: '' }).couponCode).toBeNull();
  });

  it('requires items, a client and item references', () => {
    expect(billSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(billSchema.safeParse({ items: base.items }).success).toBe(false);
    const res = billSchema.safeParse({ ...base, items: [{ kind: 'PRODUCT' }] });
    expect(res.error.issues[0].path).toEqual(['items', 0, 'refId']);
  });

  it('requires a value of at least ₹1 for gift cards', () => {
    expect(billSchema.safeParse({ ...base, items: [{ kind: 'GIFT_CARD' }] }).success).toBe(false);
    expect(billSchema.safeParse({ ...base, items: [{ kind: 'GIFT_CARD', unitPricePaise: 99 }] }).success).toBe(false);
    expect(billSchema.safeParse({ ...base, items: [{ kind: 'GIFT_CARD', unitPricePaise: 100 }] }).success).toBe(true);
  });

  it('validates discounts', () => {
    const item = (discount) => ({ ...base, items: [{ ...base.items[0], discount }] });
    expect(billSchema.safeParse(item({ type: 'PERCENT', value: 12.5 })).success).toBe(true);
    expect(billSchema.safeParse(item({ type: 'PERCENT', value: 101 })).success).toBe(false);
    expect(billSchema.safeParse(item({ type: 'FLAT', value: 10.5 })).success).toBe(false);
    expect(billSchema.safeParse(item({ type: 'OTHER', value: 1 })).success).toBe(false);
  });

  it('validates payments', () => {
    expect(billSchema.safeParse({ ...base, payments: [{ method: 'CASH', amountPaise: 0 }] }).success).toBe(false);
    expect(billSchema.safeParse({ ...base, payments: [{ method: 'GIFT_CARD', amountPaise: 100 }] }).success).toBe(false);
    expect(billSchema.safeParse({ ...base, payments: [{ method: 'UPI', amountPaise: 100, reference: 'TX1' }] }).success).toBe(true);
  });

  it('only redeems package services', () => {
    expect(billSchema.safeParse({ ...base, items: [{ kind: 'PRODUCT', refId: UUID, clientPackageItemId: UUID }] }).success).toBe(false);
    expect(billSchema.safeParse({ ...base, items: [{ kind: 'SERVICE', clientPackageItemId: UUID }] }).success).toBe(true);
  });
});

describe('other payloads', () => {
  it('validates due collections, voids, top-ups and point adjustments', () => {
    expect(billPaymentSchema.safeParse({ method: 'CASH', amountPaise: 500 }).success).toBe(true);
    expect(voidBillSchema.safeParse({ reason: ' ' }).success).toBe(false);
    expect(walletTopupSchema.safeParse({ amountPaise: 99, method: 'CASH' }).success).toBe(false);
    expect(walletTopupSchema.safeParse({ amountPaise: 100, method: 'WALLET' }).success).toBe(false);
    expect(walletTopupSchema.safeParse({ amountPaise: 100, method: 'UPI' }).success).toBe(true);
    expect(pointsAdjustmentSchema.safeParse({ points: 0, note: 'x' }).success).toBe(false);
    expect(pointsAdjustmentSchema.safeParse({ points: '-20', note: 'Correction' }).data).toEqual({ points: -20, note: 'Correction' });
  });
});
