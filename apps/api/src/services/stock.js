import { EXPIRY_ALERT_DAYS } from '@salon/shared/inventory';
import { addDaysIso, fromIsoDate, toIsoDate } from '../lib/dates.js';
import { badRequest } from '../lib/errors.js';

// Stock on hand is never stored: it is the sum of a product's StockMovement.qtyChange in a branch.
// Billing (SALE) may take it below zero, so callers must never assume it is >= 0.

/** Map productId -> stock on hand in `branchId` (products without movements are 0). */
export async function stockOnHand(db, branchId, productIds) {
  const where = { branchId };
  if (productIds) where.productId = { in: [...new Set(productIds)] };
  const rows = await db.stockMovement.groupBy({ by: ['productId'], where, _sum: { qtyChange: true } });
  return new Map(rows.map((row) => [row.productId, row._sum.qtyChange ?? 0]));
}

/** Row locks on the products so concurrent usage/transfers of the same product run one after another. */
export async function lockProducts(tx, productIds) {
  const ids = [...new Set(productIds)];
  if (ids.length) await tx.$queryRaw`SELECT id FROM "Product" WHERE id = ANY(${ids}) FOR UPDATE`;
}

/**
 * Throws a 400 when any `{ productId, qty, field }` needs more than is in stock.
 * `field` is the request field the error is reported on (e.g. "qty" or "items.2.qty").
 */
export async function assertInStock(db, branchId, needs) {
  const stock = await stockOnHand(db, branchId, needs.map((n) => n.productId));
  const details = {};
  for (const { productId, qty, field } of needs) {
    const available = stock.get(productId) ?? 0;
    if (qty > available) details[field] = `Only ${Math.max(available, 0)} in stock`;
  }
  if (Object.keys(details).length) throw badRequest('Not enough stock', details);
}

export const productDto = (product, stock = 0) => ({
  ...product,
  volume: product.volume === null || product.volume === undefined ? null : Number(product.volume),
  stockOnHand: stock,
  isLow: stock <= product.lowStockAt,
});

/** Products (with stock) for a branch, given already loaded rows. */
export async function withStock(db, branchId, products) {
  const stock = await stockOnHand(db, branchId, products.map((p) => p.id));
  return products.map((p) => productDto(p, stock.get(p.id) ?? 0));
}

/** Active products at or below their low-stock level. */
export async function lowStockProducts(db, branchId) {
  const products = await db.product.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } });
  return (await withStock(db, branchId, products)).filter((p) => p.isLow);
}

/**
 * Purchase lots expiring within EXPIRY_ALERT_DAYS of `today` (or already expired) for products still in stock.
 */
export async function expiringLots(db, branchId, today) {
  const lots = await db.purchaseItem.findMany({
    where: {
      purchase: { branchId },
      expiresOn: { not: null, lte: fromIsoDate(addDaysIso(today, EXPIRY_ALERT_DAYS)) },
      product: { isActive: true },
    },
    include: { product: { select: { id: true, name: true, brand: true } }, purchase: { select: { purchasedOn: true } } },
    orderBy: [{ expiresOn: 'asc' }, { id: 'asc' }],
    take: 500,
  });
  const stock = await stockOnHand(db, branchId, lots.map((lot) => lot.productId));
  return lots
    .filter((lot) => (stock.get(lot.productId) ?? 0) > 0)
    .map((lot) => {
      const expiresOn = toIsoDate(lot.expiresOn);
      return {
        id: lot.id,
        productId: lot.productId,
        productName: lot.product.name,
        brand: lot.product.brand,
        lotNo: lot.lotNo,
        expiresOn,
        qty: lot.qty,
        purchasedOn: toIsoDate(lot.purchase.purchasedOn),
        stockOnHand: stock.get(lot.productId),
        expired: expiresOn < today,
      };
    });
}
