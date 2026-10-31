import { formatINR, percentOf } from '@salon/shared';
import { normalizeGiftCardCode, randomGiftCardCode } from '@salon/shared/catalogue';
import { config } from '../config.js';
import { addDaysIso, fromIsoDate, toIsoDate } from '../lib/dates.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { nextBillNumber } from './billNumbers.js';
import { checkPayments, lockClient, priceBill } from './billing.js';
import { queueTemplated } from './messaging.js';

// Everything that writes bills. Each function expects to run inside one prisma.$transaction (sequential awaits only).

const GIFT_CARD_DAYS = 365;

async function newGiftCardCode(tx) {
  for (;;) {
    const code = randomGiftCardCode();
    if (!(await tx.giftCard.findUnique({ where: { code }, select: { id: true } }))) return code;
  }
}

const statusFor = (duePaise) => (duePaise === 0 ? 'PAID' : 'PARTIAL');

/** Record bill/due payments and their wallet and gift-card effects. */
async function recordPayments(tx, { ctx, bill, payments, kind, giftCards }) {
  for (const p of payments) {
    const card = p.method === 'GIFT_CARD' ? giftCards.get(normalizeGiftCardCode(p.reference)) : null;
    const payment = await tx.payment.create({
      data: {
        branchId: ctx.branchId,
        clientId: bill.clientId,
        billId: bill.id,
        kind,
        method: p.method,
        amountPaise: p.amountPaise,
        reference: card ? card.code : p.reference,
        giftCardId: card?.id ?? null,
        createdById: ctx.user.id,
      },
    });
    if (p.method === 'WALLET') {
      await tx.walletEntry.create({
        data: {
          clientId: bill.clientId, branchId: ctx.branchId, amountPaise: -p.amountPaise, reason: 'BILL_PAYMENT',
          billId: bill.id, paymentId: payment.id, note: `Bill ${bill.number}`, createdById: ctx.user.id,
        },
      });
    }
    if (card) {
      const { count } = await tx.giftCard.updateMany({
        where: { id: card.id, isActive: true, balancePaise: { gte: p.amountPaise } },
        data: { balancePaise: { decrement: p.amountPaise } },
      });
      if (!count) throw conflict('The gift card balance changed. Please try again.');
    }
  }
}

/** Create a bill and all its side effects. Returns the bill id. */
export async function createBill(tx, ctx, body) {
  await lockClient(tx, body.clientId);
  const priced = await priceBill(tx, ctx, body, { strict: true });
  const { client, lines, totals, membership } = priced;
  const today = ctx.today;
  const paidPaise = priced.advancePaise + priced.paymentsPaise;
  const duePaise = totals.totalPaise - paidPaise;

  const bill = await tx.bill.create({
    data: {
      branchId: ctx.branchId,
      number: await nextBillNumber(tx, ctx.branchId),
      clientId: client.id,
      status: statusFor(duePaise),
      ...totals,
      paidPaise,
      duePaise,
      couponId: priced.coupon?.id ?? null,
      couponDiscountPaise: priced.couponDiscountPaise,
      manualDiscountPaise: priced.manualDiscountPaise,
      pointsRedeemed: priced.pointsRedeemed,
      pointsDiscountPaise: priced.pointsDiscountPaise,
      pointsEarned: priced.pointsEarned + priced.bonusPoints,
      notes: body.notes,
      createdById: ctx.user.id,
    },
  });

  for (const line of lines) {
    let commissionPaise = 0;
    if (line.staff && !line.clientPackageItemId && line.kind !== 'GIFT_CARD') {
      const pct = line.kind === 'PRODUCT' ? line.staff.productCommissionPct : line.staff.serviceCommissionPct;
      commissionPaise = percentOf(line.taxablePaise, Number(pct));
    }
    const item = await tx.billItem.create({
      data: {
        billId: bill.id,
        kind: line.kind,
        name: line.name,
        serviceId: line.serviceId,
        productId: line.productId,
        packageId: line.packageId,
        membershipPlanId: line.membershipPlanId,
        clientPackageItemId: line.clientPackageItemId,
        staffId: line.staff?.id ?? null,
        qty: line.qty,
        unitPricePaise: line.unitPricePaise,
        discountPaise: line.discountPaise,
        taxRateId: line.taxRate?.id ?? null,
        taxPct: line.taxPct,
        taxPaise: line.taxPaise,
        totalPaise: line.totalPaise,
        commissionPaise,
      },
    });

    if (line.kind === 'PRODUCT') {
      // Stock may go negative: a sale is never blocked by the stock count.
      await tx.stockMovement.create({
        data: {
          branchId: ctx.branchId, productId: line.productId, qtyChange: -line.qty, reason: 'SALE', billItemId: item.id,
          staffId: line.staff?.id ?? null, note: `Bill ${bill.number}`, createdById: ctx.user.id,
        },
      });
    } else if (line.kind === 'PACKAGE') {
      await tx.clientPackage.create({
        data: {
          clientId: client.id,
          packageId: line.packageId,
          branchId: ctx.branchId,
          purchasedOn: fromIsoDate(today),
          expiresOn: fromIsoDate(addDaysIso(today, line.ref.validityDays)),
          billId: bill.id,
          items: { create: line.ref.items.map((pi) => ({ serviceId: pi.serviceId, totalQty: pi.qty * line.qty })) },
        },
      });
    } else if (line.clientPackageItemId) {
      await tx.clientPackageItem.update({ where: { id: line.clientPackageItemId }, data: { usedQty: { increment: line.qty } } });
    } else if (line.kind === 'MEMBERSHIP') {
      // A renewal starts the day after the latest current membership ends.
      const latest = await tx.clientMembership.findFirst({
        where: { clientId: client.id, cancelledAt: null, endsOn: { gte: fromIsoDate(today) } },
        orderBy: { endsOn: 'desc' },
      });
      const startsOn = latest ? addDaysIso(toIsoDate(latest.endsOn), 1) : today;
      await tx.clientMembership.create({
        data: {
          clientId: client.id,
          planId: line.membershipPlanId,
          branchId: ctx.branchId,
          startsOn: fromIsoDate(startsOn),
          endsOn: fromIsoDate(addDaysIso(startsOn, line.ref.durationDays - 1)),
          billId: bill.id,
        },
      });
    } else if (line.kind === 'GIFT_CARD') {
      await tx.giftCard.create({
        data: {
          organizationId: ctx.organizationId,
          code: await newGiftCardCode(tx),
          initialPaise: line.unitPricePaise,
          balancePaise: line.unitPricePaise,
          clientId: client.id,
          issuedBillId: bill.id,
          expiresOn: fromIsoDate(addDaysIso(today, GIFT_CARD_DAYS)),
        },
      });
    }
  }

  await recordPayments(tx, { ctx, bill, payments: body.payments, kind: 'BILL', giftCards: priced.giftCards });

  if (priced.advances.length) {
    const { count } = await tx.payment.updateMany({
      where: { id: { in: priced.advances.map((p) => p.id) }, billId: null },
      data: { billId: bill.id },
    });
    if (count !== priced.advances.length) throw conflict('The appointment advance changed. Please try again.');
  }
  if (priced.appointment) {
    await tx.appointment.update({ where: { id: priced.appointment.id }, data: { status: 'BILLED', billId: bill.id } });
  }

  const points = (amount, note) => ({ clientId: client.id, branchId: ctx.branchId, points: amount, billId: bill.id, note, createdById: ctx.user.id });
  if (priced.pointsRedeemed > 0) {
    await tx.pointsEntry.create({ data: { ...points(-priced.pointsRedeemed, `Redeemed on bill ${bill.number}`), reason: 'REDEEM' } });
  }
  if (priced.pointsEarned > 0) {
    const multiplier = membership?.plan.pointsMultiplier ?? 1;
    const note = multiplier > 1 ? `Earned on bill ${bill.number} (${multiplier}× member points)` : `Earned on bill ${bill.number}`;
    await tx.pointsEntry.create({ data: { ...points(priced.pointsEarned, note), reason: 'EARN' } });
  }
  if (priced.bonusPoints > 0) {
    await tx.pointsEntry.create({ data: { ...points(priced.bonusPoints, `Membership bonus, bill ${bill.number}`), reason: 'EARN' } });
  }

  if (body.sendReceipt) {
    await queueTemplated(tx, {
      branchId: ctx.branchId,
      client: { id: client.id, name: client.name, phone: client.phone, email: client.email },
      kind: 'BILL_RECEIPT',
      vars: { billNumber: bill.number, amount: formatINR(totals.totalPaise), feedbackLink: `${config.appUrl}/feedback/${bill.feedbackToken}` },
      createdById: ctx.user.id,
    });
  }
  return bill.id;
}

async function lockedBill(tx, ctx, billId, include) {
  const found = await tx.bill.findFirst({ where: { id: billId, branchId: ctx.branchId }, select: { clientId: true } });
  if (!found) throw notFound('Bill');
  await lockClient(tx, found.clientId);
  return tx.bill.findUnique({ where: { id: billId }, include });
}

/** Collect (part of) the amount due on a bill. */
export async function collectBillPayment(tx, ctx, billId, body) {
  const bill = await lockedBill(tx, ctx, billId);
  if (bill.status === 'VOID') throw conflict('This bill has been voided');
  if (bill.duePaise <= 0) throw badRequest('Nothing is due on this bill', { amountPaise: 'Nothing is due on this bill' });

  const giftCards = await checkPayments(tx, {
    organizationId: ctx.organizationId,
    today: ctx.today,
    clientId: bill.clientId,
    payments: [body],
    limitPaise: bill.duePaise,
    overField: 'amountPaise',
    fieldFor: (i, name) => name,
    soft: { add: (field, message) => { throw badRequest(message, { [field]: message }); } },
  });
  await recordPayments(tx, { ctx, bill, payments: [body], kind: 'DUE_COLLECTION', giftCards });

  const duePaise = bill.duePaise - body.amountPaise;
  await tx.bill.update({
    where: { id: bill.id },
    data: { paidPaise: bill.paidPaise + body.amountPaise, duePaise, status: statusFor(duePaise) },
  });
}

/**
 * Void a bill and undo its effects. Payments stay on the bill (reports exclude VOID bills from collections);
 * wallet and gift-card money is given back, appointment advances return to the appointment.
 */
export async function voidBill(tx, ctx, billId, { reason }) {
  const bill = await lockedBill(tx, ctx, billId, {
    items: true,
    payments: true,
    pointsEntries: true,
    clientPackages: { include: { items: true } },
    clientMemberships: true,
    giftCardsIssued: true,
    appointment: { select: { id: true } },
  });
  if (bill.status === 'VOID') throw conflict('This bill is already void');
  if (bill.clientPackages.some((cp) => !cp.cancelledAt && cp.items.some((i) => i.usedQty > 0))) {
    throw conflict('A package sold on this bill has already been used, so the bill cannot be voided');
  }
  if (bill.giftCardsIssued.some((g) => g.balancePaise < g.initialPaise)) {
    throw conflict('A gift card sold on this bill has already been spent, so the bill cannot be voided');
  }

  const note = `Void of bill ${bill.number}`;
  for (const p of bill.payments) {
    if (p.kind === 'ADVANCE') {
      await tx.payment.update({ where: { id: p.id }, data: { billId: null } });
    } else if (p.method === 'WALLET') {
      await tx.walletEntry.create({
        data: {
          clientId: bill.clientId, branchId: ctx.branchId, amountPaise: p.amountPaise, reason: 'REFUND', billId: bill.id,
          paymentId: p.id, note, createdById: ctx.user.id,
        },
      });
    } else if (p.method === 'GIFT_CARD' && p.giftCardId) {
      await tx.giftCard.update({ where: { id: p.giftCardId }, data: { balancePaise: { increment: p.amountPaise } } });
    }
  }

  for (const entry of bill.pointsEntries) {
    if (entry.reason !== 'EARN' && entry.reason !== 'REDEEM') continue;
    await tx.pointsEntry.create({
      data: { clientId: bill.clientId, branchId: ctx.branchId, points: -entry.points, reason: 'REVERSAL', billId: bill.id, note, createdById: ctx.user.id },
    });
  }

  for (const item of bill.items) {
    if (item.kind === 'PRODUCT' && item.productId) {
      await tx.stockMovement.create({
        data: { branchId: ctx.branchId, productId: item.productId, qtyChange: item.qty, reason: 'BILL_VOID', billItemId: item.id, note, createdById: ctx.user.id },
      });
    }
    if (item.clientPackageItemId) {
      await tx.clientPackageItem.update({ where: { id: item.clientPackageItemId }, data: { usedQty: { decrement: item.qty } } });
    }
  }

  const now = new Date();
  await tx.clientPackage.updateMany({ where: { billId: bill.id, cancelledAt: null }, data: { cancelledAt: now } });
  await tx.clientMembership.updateMany({ where: { billId: bill.id, cancelledAt: null }, data: { cancelledAt: now } });
  await tx.giftCard.updateMany({ where: { issuedBillId: bill.id }, data: { isActive: false } });
  if (bill.appointment) {
    await tx.appointment.update({ where: { id: bill.appointment.id }, data: { status: 'CHECKED_IN', billId: null } });
  }
  await tx.bill.update({ where: { id: bill.id }, data: { status: 'VOID', voidedAt: now, voidReason: reason } });
}
