import { formatINR, percentOf, ROLES } from '@salon/shared';
import { computeBill, gstSplit, lineDiscountFrom } from '@salon/shared/billing';
import { couponDiscountPaise, normalizeGiftCardCode } from '@salon/shared/catalogue';
import { config } from '../config.js';
import { fromIsoDate, todayIso, toIsoDate } from '../lib/dates.js';
import { badRequest, forbidden } from '../lib/errors.js';

// Bill pricing shared by POST /bills (strict, inside the transaction) and POST /bills/preview (no writes).
// Money is integer paise throughout; the math itself lives in @salon/shared/billing.

const SETTING_DEFAULTS = {
  redeemPoints: 1, redeemValuePaise: 100, maxRedeemPoints: 0, roundOffBills: true, defaultServiceTaxId: null, defaultProductTaxId: null,
};

export const billContext = (req) => ({
  branchId: req.branchId,
  organizationId: req.branch.organizationId,
  user: req.user,
  today: todayIso(config.timezone),
});

const hard = (field, message) => badRequest(message, { [field]: message });

/** Soft errors are thrown in strict mode and collected for the preview, so the POS can show them inline. */
function collector(strict) {
  const errors = {};
  return {
    errors,
    add(field, message) {
      if (strict) throw hard(field, message);
      if (!errors[field]) errors[field] = message;
    },
  };
}

/** Row lock so bills, payments and adjustments for one client run one after another (wallet, points, packages). */
export async function lockClient(tx, clientId) {
  await tx.$executeRaw`SELECT id FROM "Client" WHERE id = ${clientId} FOR UPDATE`;
}

export async function branchSettings(db, branchId) {
  const row = await db.branchSetting.findUnique({ where: { branchId } });
  return { ...SETTING_DEFAULTS, ...row };
}

export async function walletBalance(db, clientId) {
  const agg = await db.walletEntry.aggregate({ where: { clientId }, _sum: { amountPaise: true } });
  return agg._sum.amountPaise ?? 0;
}

export async function pointsBalance(db, clientId) {
  const agg = await db.pointsEntry.aggregate({ where: { clientId }, _sum: { points: true } });
  return agg._sum.points ?? 0;
}

/** The membership in force today (memberships are honoured in every branch of the organisation). */
export function activeMembership(db, clientId, today) {
  const date = fromIsoDate(today);
  return db.clientMembership.findFirst({
    where: { clientId, cancelledAt: null, startsOn: { lte: date }, endsOn: { gte: date } },
    include: { plan: true },
    orderBy: { endsOn: 'desc' },
  });
}

export const membershipDto = (m) =>
  m && {
    id: m.id,
    planId: m.planId,
    name: m.plan.name,
    startsOn: toIsoDate(m.startsOn),
    endsOn: toIsoDate(m.endsOn),
    useMemberPrices: m.plan.useMemberPrices,
    productDiscountPct: Number(m.plan.productDiscountPct),
    packageDiscountPct: Number(m.plan.packageDiscountPct),
    pointsMultiplier: m.plan.pointsMultiplier,
  };

/** Paise value of `points` under the branch's redemption rate (always rounded down). */
export const pointsValuePaise = (points, settings) => Math.floor((points * settings.redeemValuePaise) / settings.redeemPoints);

const taxFits = (tax, category) => tax.appliesTo === 'ALL' || tax.appliesTo === category;
const byId = (rows) => new Map(rows.map((row) => [row.id, row]));
const findMany = (delegate, ids, where, extra = {}) =>
  ids.length ? delegate.findMany({ where: { id: { in: ids }, ...where }, ...extra }) : Promise.resolve([]);

/**
 * Validate the payments for a bill or a due collection.
 * `fieldFor(index, name)` names the error field; `overField` gets the overpayment error.
 * Returns the gift cards being charged, keyed by code.
 */
export async function checkPayments(db, { organizationId, today, clientId, payments, alreadyPaidPaise = 0, limitPaise, overField, fieldFor, soft }) {
  const paying = payments.reduce((sum, p) => sum + p.amountPaise, 0);
  if (alreadyPaidPaise > limitPaise) {
    soft.add(overField, `The advance of ${formatINR(alreadyPaidPaise)} is more than the bill total`);
  } else if (alreadyPaidPaise + paying > limitPaise) {
    soft.add(overField, `Payments are more than the ${formatINR(limitPaise - alreadyPaidPaise)} to be paid`);
  }

  const walletIdx = payments.map((p, i) => (p.method === 'WALLET' ? i : -1)).filter((i) => i >= 0);
  if (walletIdx.length) {
    const balance = await walletBalance(db, clientId);
    const wanted = walletIdx.reduce((sum, i) => sum + payments[i].amountPaise, 0);
    if (wanted > balance) soft.add(fieldFor(walletIdx.at(-1), 'amountPaise'), `Wallet balance is only ${formatINR(balance)}`);
  }

  const cards = new Map();
  const giftIdx = payments.map((p, i) => (p.method === 'GIFT_CARD' ? i : -1)).filter((i) => i >= 0);
  if (giftIdx.length) {
    const codes = [...new Set(giftIdx.map((i) => normalizeGiftCardCode(payments[i].reference)))];
    const rows = await db.giftCard.findMany({ where: { organizationId, code: { in: codes } } });
    for (const row of rows) cards.set(row.code, row);
    const used = new Map();
    for (const i of giftIdx) {
      const code = normalizeGiftCardCode(payments[i].reference);
      const card = cards.get(code);
      if (!card || !card.isActive) {
        soft.add(fieldFor(i, 'reference'), 'Gift card not found');
        continue;
      }
      if (card.expiresOn && toIsoDate(card.expiresOn) < today) {
        soft.add(fieldFor(i, 'reference'), 'This gift card has expired');
        continue;
      }
      const total = (used.get(code) ?? 0) + payments[i].amountPaise;
      used.set(code, total);
      if (total > card.balancePaise) soft.add(fieldFor(i, 'amountPaise'), `Gift card balance is only ${formatINR(card.balancePaise)}`);
    }
  }
  return cards;
}

async function couponDiscount(db, { coupon, eligiblePaise, clientId, today, strict }) {
  if (!coupon || !coupon.isActive) return { problem: 'This coupon code is not valid' };
  if (coupon.validFrom && toIsoDate(coupon.validFrom) > today) return { problem: 'This coupon is not valid yet' };
  if (coupon.validTo && toIsoDate(coupon.validTo) < today) return { problem: 'This coupon has expired' };
  if (eligiblePaise < coupon.minBillPaise) return { problem: `This coupon needs a bill of ${formatINR(coupon.minBillPaise)} or more` };
  // Serialise concurrent uses of a limited coupon.
  if (strict && (coupon.totalUsageLimit != null || coupon.usageLimitPerClient != null)) {
    await db.$executeRaw`SELECT id FROM "Coupon" WHERE id = ${coupon.id} FOR UPDATE`;
  }
  if (coupon.totalUsageLimit != null) {
    const used = await db.bill.count({ where: { couponId: coupon.id, status: { not: 'VOID' } } });
    if (used >= coupon.totalUsageLimit) return { problem: 'This coupon has been fully used' };
  }
  if (coupon.usageLimitPerClient != null) {
    const used = await db.bill.count({ where: { couponId: coupon.id, clientId, status: { not: 'VOID' } } });
    if (used >= coupon.usageLimitPerClient) return { problem: 'This client has already used this coupon' };
  }
  const amount = couponDiscountPaise({ ...coupon, discountPct: Number(coupon.discountPct ?? 0) }, eligiblePaise);
  return { amount: Math.max(0, amount) };
}

/**
 * Price a bill payload (billSchema output) without writing anything.
 * strict: throw on coupon/points/payment problems (POST /bills); otherwise collect them in `errors` and price without
 * the offending coupon/points (POST /bills/preview). Problems with the items themselves always throw.
 */
export async function priceBill(db, ctx, body, { strict }) {
  const { branchId, organizationId, user, today } = ctx;
  const soft = collector(strict);
  const isManager = user.role !== ROLES.USER;

  const client = await db.client.findFirst({ where: { id: body.clientId, organizationId } });
  if (!client) throw hard('clientId', 'Pick a valid client');

  const settings = await branchSettings(db, branchId);
  const membership = await activeMembership(db, client.id, today);
  const plan = membership?.plan ?? null;

  const refs = (kind) => [...new Set(body.items.filter((i) => i.kind === kind && !i.clientPackageItemId && i.refId).map((i) => i.refId))];
  const services = byId(await findMany(db.service, refs('SERVICE'), { branchId, isActive: true }));
  const products = byId(await findMany(db.product, refs('PRODUCT'), { branchId, isActive: true, isRetail: true }));
  const packages = byId(await findMany(db.package, refs('PACKAGE'), { branchId, isActive: true }, { include: { items: true } }));
  const plans = byId(await findMany(db.membershipPlan, refs('MEMBERSHIP'), { branchId, isActive: true }));
  const packageItems = byId(
    await findMany(
      db.clientPackageItem,
      [...new Set(body.items.map((i) => i.clientPackageItemId).filter(Boolean))],
      { clientPackage: { clientId: client.id, branchId } },
      { include: { service: true, clientPackage: { include: { package: { select: { name: true } } } } } },
    ),
  );
  const staff = byId(await findMany(db.staff, [...new Set(body.items.map((i) => i.staffId).filter(Boolean))], { branchId, isActive: true }));
  const taxIds = new Set([settings.defaultServiceTaxId, settings.defaultProductTaxId]);
  for (const item of body.items) taxIds.add(item.taxRateId);
  for (const product of products.values()) taxIds.add(product.taxRateId);
  const taxes = byId(await findMany(db.taxRate, [...taxIds].filter(Boolean), { branchId, isActive: true }));

  const redeemedQty = new Map();
  let membershipLines = 0;
  const lines = body.items.map((item, index) => {
    const field = (name) => `items.${index}.${name}`;
    const line = {
      index, kind: item.kind, qty: item.qty, staffId: item.staffId, staff: null,
      serviceId: null, productId: null, packageId: null, membershipPlanId: null, clientPackageItemId: null,
      taxRate: null, noBillDiscount: false, memberDiscount: false, rewardPoints: 0, bonusPoints: 0, ref: null,
    };
    if (item.staffId) {
      line.staff = staff.get(item.staffId);
      if (!line.staff) throw hard(field('staffId'), 'Pick an active staff member of this branch');
    }

    const priced = (catalogPaise) => {
      if (item.unitPricePaise == null || item.unitPricePaise === catalogPaise) return catalogPaise;
      if (!isManager) throw forbidden('Only managers can change prices');
      return item.unitPricePaise;
    };
    const resolveTax = (category, fallbacks) => {
      if (item.taxRateId === null) return null;
      if (item.taxRateId !== undefined) {
        const tax = taxes.get(item.taxRateId);
        if (!tax || !taxFits(tax, category)) throw hard(field('taxRateId'), 'Pick an active tax that applies to this item');
        return tax;
      }
      // Defaults that are inactive or don't fit are skipped rather than blocking the sale.
      for (const id of fallbacks) {
        const tax = id && taxes.get(id);
        if (tax && taxFits(tax, category)) return tax;
      }
      return null;
    };

    if (item.kind === 'SERVICE' && item.clientPackageItemId) {
      const cpi = packageItems.get(item.clientPackageItemId);
      if (!cpi) throw hard(field('clientPackageItemId'), "This package service isn't available for this client here");
      if (cpi.clientPackage.cancelledAt) throw hard(field('clientPackageItemId'), 'This package has been cancelled');
      if (toIsoDate(cpi.clientPackage.expiresOn) < today) throw hard(field('clientPackageItemId'), 'This package has expired');
      if (item.refId && item.refId !== cpi.serviceId) throw hard(field('refId'), "This service isn't part of that package");
      const already = redeemedQty.get(cpi.id) ?? 0;
      const left = cpi.totalQty - cpi.usedQty - already;
      if (item.qty > left) throw hard(field('qty'), left > 0 ? `Only ${left} left in this package` : 'Nothing left in this package');
      redeemedQty.set(cpi.id, already + item.qty);
      return Object.assign(line, {
        name: `${cpi.service.name} (package)`,
        serviceId: cpi.serviceId,
        clientPackageItemId: cpi.id,
        packageName: cpi.clientPackage.package.name,
        unitPricePaise: 0,
        lineDiscountPaise: 0,
        noBillDiscount: true,
      });
    }

    if (item.kind === 'GIFT_CARD') {
      return Object.assign(line, { name: 'Gift card', unitPricePaise: item.unitPricePaise, lineDiscountPaise: 0, noBillDiscount: true });
    }

    let catalogPaise;
    let category = 'SERVICE';
    let fallbacks = [settings.defaultServiceTaxId];
    let memberPct = 0;
    if (item.kind === 'SERVICE') {
      const service = services.get(item.refId);
      if (!service) throw hard(field('refId'), 'Pick an active service of this branch');
      Object.assign(line, { ref: service, name: service.name, serviceId: service.id, rewardPoints: service.rewardPoints * item.qty });
      catalogPaise = plan?.useMemberPrices ? service.memberPricePaise : service.pricePaise;
    } else if (item.kind === 'PRODUCT') {
      const product = products.get(item.refId);
      if (!product) throw hard(field('refId'), 'Pick an active retail product of this branch');
      Object.assign(line, { ref: product, name: product.name, productId: product.id, rewardPoints: product.rewardPoints * item.qty });
      catalogPaise = product.salePricePaise;
      category = 'PRODUCT';
      fallbacks = [product.taxRateId, settings.defaultProductTaxId];
      memberPct = Number(plan?.productDiscountPct ?? 0);
    } else if (item.kind === 'PACKAGE') {
      const pkg = packages.get(item.refId);
      if (!pkg) throw hard(field('refId'), 'Pick an active package of this branch');
      Object.assign(line, { ref: pkg, name: pkg.name, packageId: pkg.id });
      catalogPaise = pkg.pricePaise;
      memberPct = Number(plan?.packageDiscountPct ?? 0);
    } else {
      const membershipPlan = plans.get(item.refId);
      if (!membershipPlan) throw hard(field('refId'), 'Pick an active membership plan of this branch');
      membershipLines += 1;
      if (membershipLines > 1) throw hard(field('refId'), 'Sell one membership per bill');
      Object.assign(line, { ref: membershipPlan, name: membershipPlan.name, membershipPlanId: membershipPlan.id, bonusPoints: membershipPlan.rewardPoints });
      catalogPaise = membershipPlan.pricePaise;
    }

    line.unitPricePaise = priced(catalogPaise);
    const gross = line.unitPricePaise * item.qty;
    const given = lineDiscountFrom(item.discount, gross);
    const member = memberPct > 0 ? Math.min(gross, percentOf(gross, memberPct)) : 0;
    line.memberDiscount = member > given;
    line.lineDiscountPaise = Math.max(given, member);
    line.taxRate = resolveTax(category, fallbacks);
    return line;
  });
  for (const line of lines) line.grossPaise = line.unitPricePaise * line.qty;

  // Bill-level discounts: coupon, then points, then manual — never more than the discountable amount.
  const eligiblePaise = lines.filter((l) => !l.noBillDiscount).reduce((sum, l) => sum + l.grossPaise - l.lineDiscountPaise, 0);
  let coupon = null;
  let couponDiscountPaise = 0;
  if (body.couponCode) {
    const row = await db.coupon.findFirst({ where: { branchId, code: { equals: body.couponCode, mode: 'insensitive' } } });
    const result = await couponDiscount(db, { coupon: row, eligiblePaise, clientId: client.id, today, strict });
    if (result.problem) soft.add('couponCode', result.problem);
    else {
      coupon = row;
      couponDiscountPaise = result.amount;
    }
  }

  let available = eligiblePaise - couponDiscountPaise;
  const balancePoints = await pointsBalance(db, client.id);
  let pointsRedeemed = 0;
  let pointsDiscountPaise = 0;
  if (body.redeemPoints > 0) {
    const points = body.redeemPoints;
    const value = pointsValuePaise(points, settings);
    let problem = null;
    if (points > balancePoints) problem = `Only ${Math.max(0, balancePoints)} points available`;
    else if (settings.maxRedeemPoints > 0 && points > settings.maxRedeemPoints) problem = `At most ${settings.maxRedeemPoints} points per bill`;
    else if (value > available) {
      const usable = Math.floor(((available + 1) * settings.redeemPoints - 1) / settings.redeemValuePaise);
      problem = usable > 0 ? `At most ${usable} points can be used on this bill` : 'Nothing left to pay with points';
    }
    if (problem) soft.add('redeemPoints', problem);
    else {
      pointsRedeemed = points;
      pointsDiscountPaise = value;
      available -= value;
    }
  }
  // A percentage applies to the same amount a coupon does (after line discounts, excluding items that take no bill discount).
  const manualRequested = body.manualDiscountPct > 0 ? percentOf(eligiblePaise, body.manualDiscountPct) : body.manualDiscountPaise;
  const manualDiscountPaise = Math.min(manualRequested, available);

  const computed = computeBill({
    lines: lines.map((l) => ({
      grossPaise: l.grossPaise,
      lineDiscountPaise: l.lineDiscountPaise,
      taxPct: l.taxRate ? Number(l.taxRate.ratePct) : 0,
      noBillDiscount: l.noBillDiscount,
    })),
    billDiscountPaise: couponDiscountPaise + pointsDiscountPaise + manualDiscountPaise,
    roundOff: settings.roundOffBills,
  });
  lines.forEach((line, i) => Object.assign(line, computed.lines[i], { taxPct: line.taxRate ? Number(line.taxRate.ratePct) : 0 }));

  // Advances paid against the linked appointment count towards this bill.
  let appointment = null;
  let advances = [];
  if (body.appointmentId) {
    appointment = await db.appointment.findFirst({
      where: { id: body.appointmentId, branchId },
      include: { payments: { where: { kind: 'ADVANCE', billId: null } } },
    });
    if (!appointment) throw hard('appointmentId', 'Appointment not found');
    if (appointment.clientId !== client.id) throw hard('appointmentId', 'This appointment is for another client');
    if (appointment.billId || appointment.status === 'BILLED') throw hard('appointmentId', 'This appointment has already been billed');
    if (appointment.status === 'CANCELLED') throw hard('appointmentId', 'This appointment was cancelled');
    advances = appointment.payments;
  }
  const advancePaise = advances.reduce((sum, p) => sum + p.amountPaise, 0);
  const paymentsPaise = body.payments.reduce((sum, p) => sum + p.amountPaise, 0);

  const giftCards = await checkPayments(db, {
    organizationId,
    today,
    clientId: client.id,
    payments: body.payments,
    alreadyPaidPaise: advancePaise,
    limitPaise: computed.totalPaise,
    overField: 'payments',
    fieldFor: (i, name) => `payments.${i}.${name}`,
    soft,
  });

  const basePoints = lines.reduce((sum, l) => sum + l.rewardPoints, 0);
  const multiplier = plan?.pointsMultiplier ?? 1;
  const pointsEarned = basePoints * multiplier;
  const bonusPoints = lines.reduce((sum, l) => sum + l.bonusPoints, 0);
  const paidPaise = Math.min(advancePaise + paymentsPaise, computed.totalPaise);

  return {
    client,
    settings,
    membership,
    lines,
    totals: {
      subtotalPaise: computed.subtotalPaise,
      discountPaise: computed.discountPaise,
      taxPaise: computed.taxPaise,
      roundOffPaise: computed.roundOffPaise,
      totalPaise: computed.totalPaise,
    },
    coupon,
    couponDiscountPaise,
    pointsRedeemed,
    pointsDiscountPaise,
    manualDiscountPaise,
    appointment,
    advances,
    advancePaise,
    paymentsPaise,
    paidPaise,
    duePaise: computed.totalPaise - paidPaise,
    giftCards,
    pointsEarned,
    bonusPoints,
    pointsBalance: balancePoints,
    errors: soft.errors,
  };
}

/** What the POS shows for a priced (not yet saved) bill. */
export async function previewDto(db, priced) {
  const { settings } = priced;
  return {
    lines: priced.lines.map((l) => ({
      index: l.index,
      kind: l.kind,
      name: l.name,
      qty: l.qty,
      unitPricePaise: l.unitPricePaise,
      grossPaise: l.grossPaise,
      lineDiscountPaise: l.lineDiscountPaise,
      memberDiscount: l.memberDiscount,
      billDiscountPaise: l.billDiscountPaise,
      discountPaise: l.discountPaise,
      taxRateId: l.taxRate?.id ?? null,
      taxPct: l.taxPct,
      taxablePaise: l.taxablePaise,
      taxPaise: l.taxPaise,
      totalPaise: l.totalPaise,
    })),
    ...priced.totals,
    coupon: priced.coupon && { id: priced.coupon.id, code: priced.coupon.code, description: priced.coupon.description },
    couponDiscountPaise: priced.couponDiscountPaise,
    pointsRedeemed: priced.pointsRedeemed,
    pointsDiscountPaise: priced.pointsDiscountPaise,
    manualDiscountPaise: priced.manualDiscountPaise,
    membership: membershipDto(priced.membership),
    advancePaise: priced.advancePaise,
    paymentsPaise: priced.paymentsPaise,
    paidPaise: priced.paidPaise,
    duePaise: priced.duePaise,
    pointsEarned: priced.pointsEarned + priced.bonusPoints,
    walletBalancePaise: await walletBalance(db, priced.client.id),
    pointsBalance: priced.pointsBalance,
    pointValue: { points: settings.redeemPoints, valuePaise: settings.redeemValuePaise, maxRedeemPoints: settings.maxRedeemPoints },
    errors: priced.errors,
  };
}

// ─── Reading bills ───────────────────────────────────────────────────────────

export const billListInclude = {
  client: { select: { id: true, name: true, phone: true } },
  createdBy: { select: { name: true } },
};

export const toBillListDto = (bill) => ({
  id: bill.id,
  number: bill.number,
  billedAt: bill.billedAt,
  status: bill.status,
  subtotalPaise: bill.subtotalPaise,
  discountPaise: bill.discountPaise,
  taxPaise: bill.taxPaise,
  totalPaise: bill.totalPaise,
  paidPaise: bill.paidPaise,
  duePaise: bill.duePaise,
  client: bill.client,
  createdBy: bill.createdBy,
});

/** Full bill for the detail view and the printed invoice. Returns null when it isn't in `branchId`. */
export async function loadBillDetail(db, branchId, id) {
  const bill = await db.bill.findFirst({
    where: { id, branchId },
    include: {
      client: { select: { id: true, name: true, phone: true, email: true, address: true } },
      coupon: { select: { code: true } },
      createdBy: { select: { name: true } },
      appointment: { select: { id: true, date: true, startTime: true } },
      // BillItem has no position column; rows are inserted one by one in bill order and come back in that order.
      items: { include: { staff: { select: { id: true, name: true } } } },
      payments: { orderBy: { receivedAt: 'asc' } },
      giftCardsIssued: { select: { code: true, initialPaise: true, balancePaise: true, expiresOn: true, isActive: true } },
    },
  });
  if (!bill) return null;
  const branch = await db.branch.findUnique({
    where: { id: branchId },
    select: { name: true, salonName: true, address: true, phone: true, email: true, gstin: true },
  });

  const items = bill.items.map((item) => ({
    ...item,
    taxPct: Number(item.taxPct),
    taxablePaise: item.totalPaise - item.taxPaise,
    grossPaise: item.unitPricePaise * item.qty,
  }));
  const groups = new Map();
  for (const item of items) {
    if (!item.taxPaise && !item.taxPct) continue;
    const key = item.taxPct;
    const g = groups.get(key) ?? { ratePct: key, taxablePaise: 0, taxPaise: 0 };
    g.taxablePaise += item.taxablePaise;
    g.taxPaise += item.taxPaise;
    groups.set(key, g);
  }
  const taxBreakdown = [...groups.values()].sort((a, b) => a.ratePct - b.ratePct).map((g) => ({ ...g, ...gstSplit(g.taxPaise) }));

  return {
    ...bill,
    items,
    appointment: bill.appointment && { ...bill.appointment, date: toIsoDate(bill.appointment.date) },
    giftCardsIssued: bill.giftCardsIssued.map((g) => ({ ...g, expiresOn: toIsoDate(g.expiresOn) })),
    couponCode: bill.coupon?.code ?? null,
    branch,
    taxBreakdown,
    gst: {
      cgstPaise: taxBreakdown.reduce((sum, g) => sum + g.cgstPaise, 0),
      sgstPaise: taxBreakdown.reduce((sum, g) => sum + g.sgstPaise, 0),
    },
    feedbackLink: `${config.appUrl}/feedback/${bill.feedbackToken}`,
  };
}
