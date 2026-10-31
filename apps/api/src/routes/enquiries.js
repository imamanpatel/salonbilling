import { Router } from 'express';
import {
  convertEnquirySchema, ENQUIRY_STATUSES, ENQUIRY_TYPES, enquiryResponseSchema, enquirySchema, LEAD_SOURCES, normalizePhone,
} from '@salon/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { fromIsoDate, todayIso, toIsoDate } from '../lib/dates.js';
import { conflict } from '../lib/errors.js';
import { findInBranch, pageParams, queryString } from '../lib/http.js';
import { validateBody } from '../middleware/validate.js';
import { assertAssignee, randomReferralCode } from '../services/clients.js';

// Enquiries (leads) belong to the branch that took them.
const router = Router();
const include = {
  assignedTo: { select: { id: true, name: true } },
  client: { select: { id: true, name: true } },
};

const toData = (body) => ({ ...body, followUpOn: fromIsoDate(body.followUpOn) });
const toDto = (enquiry) => ({ ...enquiry, followUpOn: toIsoDate(enquiry.followUpOn) });

/** Link the lead to an existing client with the same phone, if there is one. */
async function existingClientId(organizationId, phone) {
  const client = await prisma.client.findUnique({ where: { organizationId_phone: { organizationId, phone } }, select: { id: true } });
  return client?.id ?? null;
}

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const q = queryString(req, 'q');
  const status = queryString(req, 'status') || 'PENDING';
  const type = queryString(req, 'type');
  const source = queryString(req, 'source');
  const assignedToId = queryString(req, 'assignedToId');
  const due = queryString(req, 'due');

  const where = { branchId: req.branchId };
  if (ENQUIRY_STATUSES.includes(status)) where.status = status;
  if (ENQUIRY_TYPES.includes(type)) where.type = type;
  if (LEAD_SOURCES.includes(source)) where.source = source;
  if (assignedToId) where.assignedToId = assignedToId;
  if (q) {
    const digits = normalizePhone(q);
    where.OR = [{ name: { contains: q, mode: 'insensitive' } }, { enquiryFor: { contains: q, mode: 'insensitive' } }];
    if (/^\+?\d{3,}$/.test(digits)) where.OR.push({ phone: { contains: digits } });
  }
  const today = fromIsoDate(todayIso(config.timezone));
  if (due === 'overdue') where.followUpOn = { lt: today };
  else if (due === 'today') where.followUpOn = today;
  else if (due === 'upcoming') where.followUpOn = { gt: today };

  const [items, total] = await prisma.$transaction([
    prisma.enquiry.findMany({
      where,
      include,
      orderBy: [{ followUpOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'desc' }],
      skip,
      take,
    }),
    prisma.enquiry.count({ where }),
  ]);
  res.json({ data: { items: items.map(toDto), total, page, pageSize } });
});

router.get('/:id', async (req, res) => {
  await findInBranch(prisma.enquiry, req.params.id, req.branchId, 'Enquiry');
  const enquiry = await prisma.enquiry.findUnique({
    where: { id: req.params.id },
    include: { ...include, responses: { include: { createdBy: { select: { name: true } } }, orderBy: { createdAt: 'desc' } } },
  });
  res.json({ data: toDto(enquiry) });
});

router.post('/', validateBody(enquirySchema), async (req, res) => {
  const organizationId = req.branch.organizationId;
  await assertAssignee(req.body.assignedToId, organizationId);
  const enquiry = await prisma.enquiry.create({
    data: { ...toData(req.body), branchId: req.branchId, clientId: await existingClientId(organizationId, req.body.phone) },
    include,
  });
  res.status(201).json({ data: toDto(enquiry) });
});

router.put('/:id', validateBody(enquirySchema), async (req, res) => {
  const existing = await findInBranch(prisma.enquiry, req.params.id, req.branchId, 'Enquiry');
  await assertAssignee(req.body.assignedToId, req.branch.organizationId);
  // Conversion is done through /convert so the client link stays consistent.
  const status = existing.status === 'CONVERTED' ? 'CONVERTED' : req.body.status === 'CONVERTED' ? existing.status : req.body.status;
  const enquiry = await prisma.enquiry.update({ where: { id: existing.id }, data: { ...toData(req.body), status }, include });
  res.json({ data: toDto(enquiry) });
});

router.post('/:id/responses', validateBody(enquiryResponseSchema), async (req, res) => {
  const enquiry = await findInBranch(prisma.enquiry, req.params.id, req.branchId, 'Enquiry');
  const changes = {};
  if (req.body.nextFollowUpOn) changes.followUpOn = fromIsoDate(req.body.nextFollowUpOn);
  if (req.body.status && enquiry.status !== 'CONVERTED') changes.status = req.body.status;

  const [response, updated] = await prisma.$transaction([
    prisma.enquiryResponse.create({
      data: { enquiryId: enquiry.id, note: req.body.note, createdById: req.user.id },
      include: { createdBy: { select: { name: true } } },
    }),
    prisma.enquiry.update({ where: { id: enquiry.id }, data: changes, include }),
  ]);
  res.status(201).json({ data: { response, enquiry: toDto(updated) } });
});

router.post('/:id/convert', validateBody(convertEnquirySchema), async (req, res) => {
  const enquiry = await findInBranch(prisma.enquiry, req.params.id, req.branchId, 'Enquiry');
  if (enquiry.status === 'CONVERTED') throw conflict('This enquiry has already been converted');
  const organizationId = req.branch.organizationId;

  const result = await prisma.$transaction(async (tx) => {
    let client = await tx.client.findUnique({ where: { organizationId_phone: { organizationId, phone: enquiry.phone } } });
    const createdClient = !client;
    if (!client) {
      client = await tx.client.create({
        data: {
          organizationId,
          homeBranchId: req.branchId,
          name: enquiry.name,
          phone: enquiry.phone,
          email: enquiry.email,
          address: enquiry.address,
          gender: req.body.gender,
          source: enquiry.source,
          assignedToId: enquiry.assignedToId,
          referralCode: randomReferralCode(),
        },
      });
    }
    const updated = await tx.enquiry.update({ where: { id: enquiry.id }, data: { status: 'CONVERTED', clientId: client.id }, include });
    return { clientId: client.id, createdClient, enquiry: toDto(updated) };
  });
  res.json({ data: result });
});

export default router;
