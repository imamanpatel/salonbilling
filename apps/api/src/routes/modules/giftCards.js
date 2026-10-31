import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { normalizePhone, ROLES, statusSchema } from '@salon/shared';
import { giftCardIssueSchema, normalizeGiftCardCode, randomGiftCardCode } from '@salon/shared/catalogue';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../../lib/dates.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';

// Gift cards belong to the organisation, so a card sold in one branch can be redeemed in any other.
export const mount = { path: '/gift-cards', scope: 'branch' };

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const include = { issuedBill: { select: { id: true, number: true, branchId: true } } };
const clientSelect = { id: true, name: true, phone: true };

const orgId = (req) => req.branch.organizationId;

/** ACTIVE (spendable), USED (no balance left), EXPIRED or INACTIVE (switched off by a manager). */
function cardStatus(card, today) {
  if (!card.isActive) return 'INACTIVE';
  if (card.balancePaise <= 0) return 'USED';
  const expiresOn = toIsoDate(card.expiresOn);
  if (expiresOn && expiresOn < today) return 'EXPIRED';
  return 'ACTIVE';
}

function statusFilter(status, today) {
  const todayDate = fromIsoDate(today);
  switch (status) {
    case 'active':
      return { isActive: true, balancePaise: { gt: 0 }, OR: [{ expiresOn: null }, { expiresOn: { gte: todayDate } }] };
    case 'used':
      return { isActive: true, balancePaise: { lte: 0 } };
    case 'expired':
      return { isActive: true, balancePaise: { gt: 0 }, expiresOn: { lt: todayDate } };
    case 'inactive':
      return { isActive: false };
    default:
      return {};
  }
}

const toDto = (card, client, today) => ({
  ...card,
  expiresOn: toIsoDate(card.expiresOn),
  client: client ?? null,
  status: cardStatus(card, today),
});

async function searchFilter(q, organizationId) {
  const or = [];
  const code = normalizeGiftCardCode(q);
  if (code) or.push({ code: { contains: code } });

  const clientWhere = [{ name: { contains: q, mode: 'insensitive' } }];
  const digits = normalizePhone(q);
  if (/^\+?\d{3,}$/.test(digits)) clientWhere.push({ phone: { contains: digits } });
  const clients = await prisma.client.findMany({ where: { organizationId, OR: clientWhere }, select: { id: true }, take: 500 });
  if (clients.length) or.push({ clientId: { in: clients.map((c) => c.id) } });
  return { OR: or };
}

async function clientsById(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await prisma.client.findMany({ where: { id: { in: unique } }, select: clientSelect });
  return new Map(rows.map((c) => [c.id, c]));
}

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const today = todayIso(config.timezone);
  const q = queryString(req, 'q');
  const and = [{ organizationId: orgId(req) }, statusFilter(queryString(req, 'status') || 'all', today)];
  if (q) and.push(await searchFilter(q, orgId(req)));
  const where = { AND: and };

  const [items, total] = await prisma.$transaction([
    prisma.giftCard.findMany({ where, include, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.giftCard.count({ where }),
  ]);
  const clients = await clientsById(items.map((card) => card.clientId));
  res.json({ data: { items: items.map((card) => toDto(card, clients.get(card.clientId), today)), total, page, pageSize } });
});

// Used by billing to check a card before taking it as payment.
router.get('/lookup/:code', async (req, res) => {
  const code = normalizeGiftCardCode(req.params.code);
  const card = code ? await prisma.giftCard.findUnique({ where: { code } }) : null;
  if (!card || card.organizationId !== orgId(req)) throw notFound('Gift card');
  const status = cardStatus(card, todayIso(config.timezone));
  res.json({
    data: {
      id: card.id,
      code: card.code,
      balancePaise: card.balancePaise,
      initialPaise: card.initialPaise,
      expiresOn: toIsoDate(card.expiresOn),
      isActive: card.isActive,
      status,
      usable: status === 'ACTIVE',
    },
  });
});

router.post('/', canWrite, validateBody(giftCardIssueSchema), async (req, res) => {
  const { initialPaise, clientId, expiresOn } = req.body;
  const today = todayIso(config.timezone);
  if (expiresOn && expiresOn < today) throw badRequest('Expiry cannot be in the past', { expiresOn: 'Cannot be in the past' });
  let client = null;
  if (clientId) {
    client = await prisma.client.findFirst({ where: { id: clientId, organizationId: orgId(req) }, select: clientSelect });
    if (!client) throw badRequest('Pick a valid client', { clientId: 'Pick a valid client' });
  }

  // Codes are random; retry on the (very unlikely) collision.
  for (let attempt = 1; ; attempt += 1) {
    try {
      const card = await prisma.giftCard.create({
        data: {
          organizationId: orgId(req),
          code: randomGiftCardCode(),
          initialPaise,
          balancePaise: initialPaise,
          clientId,
          expiresOn: fromIsoDate(expiresOn),
        },
        include,
      });
      return res.status(201).json({ data: toDto(card, client, today) });
    } catch (err) {
      const collision = err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
      if (!collision || attempt >= 5) throw err;
    }
  }
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  const card = await prisma.giftCard.findFirst({ where: { id: req.params.id, organizationId: orgId(req) } });
  if (!card) throw notFound('Gift card');
  const row = await prisma.giftCard.update({ where: { id: card.id }, data: { isActive: req.body.isActive }, include });
  const clients = await clientsById([row.clientId]);
  res.json({ data: toDto(row, clients.get(row.clientId), todayIso(config.timezone)) });
});

export default router;
