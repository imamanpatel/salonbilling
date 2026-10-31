import { formatINR } from '@salon/shared';
import { formatDate } from '../../lib/format.js';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** 365 -> "1 year", 90 -> "3 months", 45 -> "45 days" */
export function formatDays(days) {
  if (days % 365 === 0) return plural(days / 365, 'year');
  if (days % 30 === 0) return plural(days / 30, 'month');
  return plural(days, 'day');
}

/** "10% up to ₹500.00" / "10% off" / "₹200.00 off" */
export function discountLabel(coupon) {
  if (coupon.discountType === 'FLAT') return `${formatINR(coupon.discountPaise)} off`;
  return coupon.maxDiscountPaise != null ? `${coupon.discountPct}% up to ${formatINR(coupon.maxDiscountPaise)}` : `${coupon.discountPct}% off`;
}

/** "1 Oct 2026 – 30 Nov 2026", "From …", "Until …" or "No end date" */
export function validityLabel(from, to) {
  if (from && to) return `${formatDate(from)} – ${formatDate(to)}`;
  if (from) return `From ${formatDate(from)}`;
  if (to) return `Until ${formatDate(to)}`;
  return 'No end date';
}

/** Package items as "3× Haircut, 1× Hair spa". */
export const packageServicesLabel = (items) => items.map((item) => `${item.qty}× ${item.service.name}`).join(', ');

export const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'All' },
];
