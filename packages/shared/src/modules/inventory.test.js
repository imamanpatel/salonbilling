import { describe, expect, it } from 'vitest';
import { fieldErrors } from '../schemas.js';
import { productSchema, purchaseSchema, purchaseTotals, stockAdjustmentSchema, stockTransferSchema } from './inventory.js';

const PRODUCT = '00000000-0000-4000-8000-000000000001';
const VENDOR = '00000000-0000-4000-8000-000000000002';

describe('inventory schemas', () => {
  it('fills product defaults and blank optionals', () => {
    const parsed = productSchema.parse({ name: ' Serum ', brand: '', volume: '', mrpPaise: 1000, salePricePaise: 900, taxRateId: '' });
    expect(parsed).toEqual({
      name: 'Serum', brand: null, barcode: null, unit: 'PCS', volume: null, mrpPaise: 1000, salePricePaise: 900, costPricePaise: 0,
      rewardPoints: 0, lowStockAt: 5, isRetail: true, taxRateId: null, isActive: true, openingStock: 0,
    });
  });

  it('keeps the sale price at or below MRP', () => {
    const result = productSchema.safeParse({ name: 'Serum', mrpPaise: 1000, salePricePaise: 1001 });
    expect(fieldErrors(result.error)).toEqual({ salePricePaise: 'Sale price cannot be more than the MRP' });
  });

  it('computes purchase totals in paise', () => {
    const items = [{ qty: 3, costPricePaise: 1050 }, { qty: '2', costPricePaise: 999 }, { qty: 1, costPricePaise: null }];
    expect(purchaseTotals({ items, discountPaise: 150, taxPaise: 300, shippingPaise: 0 })).toEqual({ subtotalPaise: 5148, totalPaise: 5298 });
  });

  it('caps discount at the subtotal and paid at the total', () => {
    const base = { vendorId: VENDOR, purchasedOn: '2026-10-31', items: [{ productId: PRODUCT, qty: 2, costPricePaise: 500 }] };
    expect(fieldErrors(purchaseSchema.safeParse({ ...base, discountPaise: 1001 }).error)).toHaveProperty('discountPaise');
    expect(fieldErrors(purchaseSchema.safeParse({ ...base, taxPaise: 100, paidPaise: 1101 }).error)).toHaveProperty('paidPaise');
    expect(purchaseSchema.parse({ ...base, taxPaise: 100, paidPaise: 1100 }).items[0]).toMatchObject({ mrpPaise: null, lotNo: null, expiresOn: null });
  });

  it('rejects zero adjustments and duplicate transfer rows', () => {
    expect(stockAdjustmentSchema.safeParse({ productId: PRODUCT, qtyChange: 0, note: 'x' }).success).toBe(false);
    expect(stockAdjustmentSchema.parse({ productId: PRODUCT, qtyChange: '-3', note: 'Broken' }).qtyChange).toBe(-3);
    const dup = stockTransferSchema.safeParse({ toBranchId: VENDOR, items: [{ productId: PRODUCT, qty: 1 }, { productId: PRODUCT, qty: 2 }] });
    expect(fieldErrors(dup.error)).toEqual({ 'items.1.productId': 'Already in the list' });
  });
});
