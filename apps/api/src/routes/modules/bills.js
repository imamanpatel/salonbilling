import { Router } from 'express';
import { normalizePhone, ROLES } from '@salon/shared';
import { billPaymentSchema, billSchema, BILL_STATUSES, voidBillSchema } from '@salon/shared/billing';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { addDaysIso, fromIsoDate } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import {
  billContext, billListInclude, branchSettings, loadBillDetail, previewDto, priceBill, toBillListDto,
} from '../../services/billing.js';
import { collectBillPayment, createBill, voidBill } from '../../services/billingActions.js';

export const mount = { path: '/bills', scope: 'branch' };

// Bills belong to the branch that raised them. Front desk users may create bills and collect dues; only managers
// may override prices or void a bill.
const router = Router();
const canVoid = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const TX_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Start of a business-timezone calendar day as a UTC instant. */
function startOfDay(iso) {
  const utcMidnight = fromIsoDate(iso);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: config.timezone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    })
      .formatToParts(utcMidnight)
      .map((p) => [p.type, Number(p.value)]),
  );
  const offsetMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute) - utcMidnight.getTime();
  return new Date(utcMidnight.getTime() - offsetMs);
}

function dateParam(req, key) {
  const value = queryString(req, key);
  if (!value) return null;
  if (!ISO_DATE.test(value) || Number.isNaN(Date.parse(value))) throw badRequest('Use YYYY-MM-DD', { [key]: 'Use YYYY-MM-DD' });
  return value;
}

async function sendDetail(res, branchId, id, status = 200) {
  const bill = await loadBillDetail(prisma, branchId, id);
  if (!bill) throw notFound('Bill');
  res.status(status).json({ data: bill });
}

/** Everything the POS needs to add items, in one request. */
router.get('/catalogue', async (req, res) => {
  const branchId = req.branchId;
  const settings = await branchSettings(prisma, branchId);
  const [services, products, packages, membershipPlans, taxes] = await Promise.all([
    prisma.service.findMany({
      where: { branchId, isActive: true },
      include: { category: { select: { id: true, name: true } } },
      orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }],
    }),
    prisma.product.findMany({
      where: { branchId, isActive: true, isRetail: true },
      select: { id: true, name: true, brand: true, barcode: true, unit: true, mrpPaise: true, salePricePaise: true, rewardPoints: true, taxRateId: true },
      orderBy: { name: 'asc' },
    }),
    prisma.package.findMany({
      where: { branchId, isActive: true },
      include: { items: { include: { service: { select: { id: true, name: true } } } } },
      orderBy: { name: 'asc' },
    }),
    prisma.membershipPlan.findMany({ where: { branchId, isActive: true }, orderBy: { name: 'asc' } }),
    prisma.taxRate.findMany({ where: { branchId, isActive: true }, orderBy: [{ appliesTo: 'asc' }, { ratePct: 'asc' }] }),
  ]);
  res.json({
    data: {
      services,
      products,
      packages,
      membershipPlans: membershipPlans.map((p) => ({
        ...p, productDiscountPct: Number(p.productDiscountPct), packageDiscountPct: Number(p.packageDiscountPct),
      })),
      taxes: taxes.map((t) => ({ ...t, ratePct: Number(t.ratePct) })),
      defaults: { serviceTaxId: settings.defaultServiceTaxId, productTaxId: settings.defaultProductTaxId },
    },
  });
});

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const q = queryString(req, 'q');
  const status = queryString(req, 'status');
  const clientId = queryString(req, 'clientId');
  const from = dateParam(req, 'from');
  const to = dateParam(req, 'to');

  const where = { branchId: req.branchId };
  if (status === 'DUE') where.status = 'PARTIAL';
  else if (BILL_STATUSES.includes(status)) where.status = status;
  if (clientId) where.clientId = clientId;
  if (from || to) {
    where.billedAt = {};
    if (from) where.billedAt.gte = startOfDay(from);
    if (to) where.billedAt.lt = startOfDay(addDaysIso(to, 1));
  }
  if (q) {
    const digits = normalizePhone(q);
    where.OR = [
      { number: { contains: q, mode: 'insensitive' } },
      { client: { name: { contains: q, mode: 'insensitive' } } },
    ];
    if (/^\+?\d{3,}$/.test(digits)) where.OR.push({ client: { phone: { contains: digits } } });
  }

  const [items, total] = await prisma.$transaction([
    prisma.bill.findMany({ where, include: billListInclude, orderBy: [{ billedAt: 'desc' }, { number: 'desc' }], skip, take }),
    prisma.bill.count({ where }),
  ]);
  res.json({ data: { items: items.map(toBillListDto), total, page, pageSize } });
});

/** Price a bill exactly as POST / would, without saving anything. Coupon/points/payment problems come back in `errors`. */
router.post('/preview', validateBody(billSchema), async (req, res) => {
  const priced = await priceBill(prisma, billContext(req), req.body, { strict: false });
  res.json({ data: await previewDto(prisma, priced) });
});

router.post('/', validateBody(billSchema), async (req, res) => {
  const ctx = billContext(req);
  const id = await prisma.$transaction((tx) => createBill(tx, ctx, req.body), TX_OPTIONS);
  await sendDetail(res, req.branchId, id, 201);
});

router.get('/:id', async (req, res) => {
  await sendDetail(res, req.branchId, req.params.id);
});

router.post('/:id/payments', validateBody(billPaymentSchema), async (req, res) => {
  const ctx = billContext(req);
  await prisma.$transaction((tx) => collectBillPayment(tx, ctx, req.params.id, req.body), TX_OPTIONS);
  await sendDetail(res, req.branchId, req.params.id, 201);
});

router.post('/:id/void', canVoid, validateBody(voidBillSchema), async (req, res) => {
  const ctx = billContext(req);
  await prisma.$transaction((tx) => voidBill(tx, ctx, req.params.id, req.body), TX_OPTIONS);
  await sendDetail(res, req.branchId, req.params.id);
});

export default router;
