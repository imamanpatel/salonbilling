import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { pointsAdjustmentSchema, walletTopupSchema } from '@salon/shared/billing';
import { prisma } from '../../db.js';
import { fromIsoDate, toIsoDate } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  activeMembership, billContext, branchSettings, lockClient, membershipDto, pointsBalance, walletBalance,
} from '../../services/billing.js';

export const mount = { path: '/client-accounts', scope: 'branch' };

// A client's money with the salon: wallet, reward points, membership, packages, gift cards and dues.
// Wallet, points, gift cards and dues are organisation-wide; packages are listed for the current branch,
// where they can be redeemed.
const router = Router();
const canAdjust = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

async function findClient(req) {
  const client = await prisma.client.findFirst({ where: { id: req.params.clientId, organizationId: req.branch.organizationId } });
  if (!client) throw notFound('Client');
  return client;
}

async function accountSummary(req, client) {
  const { today } = billContext(req);
  const todayDate = fromIsoDate(today);
  const settings = await branchSettings(prisma, req.branchId);
  const [wallet, points, membership, packages, giftCards, due, recent] = await Promise.all([
    walletBalance(prisma, client.id),
    pointsBalance(prisma, client.id),
    activeMembership(prisma, client.id, today),
    prisma.clientPackage.findMany({
      where: { clientId: client.id, branchId: req.branchId, cancelledAt: null, expiresOn: { gte: todayDate } },
      include: { package: { select: { name: true } }, items: { include: { service: { select: { name: true } } } } },
      orderBy: { expiresOn: 'asc' },
    }),
    prisma.giftCard.findMany({
      where: {
        organizationId: req.branch.organizationId, clientId: client.id, isActive: true, balancePaise: { gt: 0 },
        OR: [{ expiresOn: null }, { expiresOn: { gte: todayDate } }],
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.bill.aggregate({ where: { clientId: client.id, status: { not: 'VOID' } }, _sum: { duePaise: true } }),
    prisma.bill.findMany({
      where: { clientId: client.id },
      select: { id: true, number: true, billedAt: true, totalPaise: true, duePaise: true, status: true, branchId: true },
      orderBy: { billedAt: 'desc' },
      take: 10,
    }),
  ]);
  const branches = await prisma.branch.findMany({
    where: { id: { in: [...new Set(recent.map((b) => b.branchId))] } },
    select: { id: true, name: true },
  });
  const branchName = new Map(branches.map((b) => [b.id, b.name]));

  return {
    walletBalancePaise: wallet,
    pointsBalance: points,
    pointValue: { points: settings.redeemPoints, valuePaise: settings.redeemValuePaise, maxRedeemPoints: settings.maxRedeemPoints },
    membership: membershipDto(membership),
    packages: packages
      .map((cp) => ({
        id: cp.id,
        name: cp.package.name,
        purchasedOn: toIsoDate(cp.purchasedOn),
        expiresOn: toIsoDate(cp.expiresOn),
        items: cp.items.map((i) => ({
          clientPackageItemId: i.id, serviceId: i.serviceId, serviceName: i.service.name, totalQty: i.totalQty, usedQty: i.usedQty,
        })),
      }))
      .filter((cp) => cp.items.some((i) => i.usedQty < i.totalQty)),
    giftCards: giftCards.map((g) => ({ code: g.code, balancePaise: g.balancePaise, expiresOn: toIsoDate(g.expiresOn) })),
    duePaise: due._sum.duePaise ?? 0,
    recentBills: recent.map(({ branchId, ...bill }) => ({ ...bill, branchId, branchName: branchName.get(branchId) ?? '' })),
  };
}

router.get('/:clientId', async (req, res) => {
  const client = await findClient(req);
  res.json({ data: await accountSummary(req, client) });
});

router.post('/:clientId/wallet-topups', validateBody(walletTopupSchema), async (req, res) => {
  const client = await findClient(req);
  await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        branchId: req.branchId, clientId: client.id, kind: 'WALLET_TOPUP', method: req.body.method,
        amountPaise: req.body.amountPaise, reference: req.body.reference, createdById: req.user.id,
      },
    });
    await tx.walletEntry.create({
      data: {
        clientId: client.id, branchId: req.branchId, amountPaise: req.body.amountPaise, reason: 'TOPUP',
        paymentId: payment.id, note: req.body.reference, createdById: req.user.id,
      },
    });
  }, TX_OPTIONS);
  res.status(201).json({ data: await accountSummary(req, client) });
});

router.post('/:clientId/points-adjustments', canAdjust, validateBody(pointsAdjustmentSchema), async (req, res) => {
  const client = await findClient(req);
  await prisma.$transaction(async (tx) => {
    await lockClient(tx, client.id);
    const balance = await pointsBalance(tx, client.id);
    if (balance + req.body.points < 0) {
      throw badRequest('Points balance cannot go below 0', { points: `Only ${Math.max(0, balance)} points can be removed` });
    }
    await tx.pointsEntry.create({
      data: {
        clientId: client.id, branchId: req.branchId, points: req.body.points, reason: 'ADJUSTMENT', note: req.body.note, createdById: req.user.id,
      },
    });
  }, TX_OPTIONS);
  res.status(201).json({ data: await accountSummary(req, client) });
});

export default router;
