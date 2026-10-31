import { Router } from 'express';
import multer from 'multer';
import { clientFollowUpSchema, clientSchema, GENDERS, LEAD_SOURCES, normalizePhone, ROLES } from '@salon/shared';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { addDaysIso, fromIsoDate, todayIso, toIsoDate } from '../lib/dates.js';
import { badRequest, notFound } from '../lib/errors.js';
import { pageParams, queryString } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { buildClientTemplate, parseClientSheet } from '../services/clientImport.js';
import { assertAssignee, clientInclude, findOrgClient, randomReferralCode, toClientData, toClientDto } from '../services/clients.js';
import { upcomingOccasions } from '../services/occasions.js';

// Clients are shared by every branch of the organisation; follow-ups record which branch logged them.
const router = Router();
const canImport = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

const NEW_CLIENT_DAYS = 30;
const OCCASION_DAYS = 7;

const orgId = (req) => req.branch.organizationId;
const followUpDto = (followUp) => ({ ...followUp, dueOn: toIsoDate(followUp.dueOn) });

async function segmentWhere(req, segment) {
  const today = todayIso(config.timezone);
  if (segment === 'new') return { createdAt: { gte: fromIsoDate(addDaysIso(today, -NEW_CLIENT_DAYS)) } };
  if (segment === 'birthdays' || segment === 'anniversaries') {
    const field = segment === 'birthdays' ? 'dob' : 'anniversary';
    const rows = await upcomingOccasions(prisma, orgId(req), field, today, OCCASION_DAYS);
    return { id: { in: rows.map((r) => r.id) } };
  }
  return {};
}

router.get('/', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const q = queryString(req, 'q');
  const source = queryString(req, 'source');
  const gender = queryString(req, 'gender');
  const assignedToId = queryString(req, 'assignedToId');

  const where = { organizationId: orgId(req), ...(await segmentWhere(req, queryString(req, 'segment'))) };
  if (q) {
    const digits = normalizePhone(q);
    where.OR = [
      { name: { contains: q, mode: 'insensitive' } },
      { email: { contains: q, mode: 'insensitive' } },
      { referralCode: q.toUpperCase() },
    ];
    if (/^\+?\d{3,}$/.test(digits)) where.OR.push({ phone: { contains: digits } });
  }
  if (LEAD_SOURCES.includes(source)) where.source = source;
  if (GENDERS.includes(gender)) where.gender = gender;
  if (assignedToId) where.assignedToId = assignedToId;

  const [items, total] = await prisma.$transaction([
    prisma.client.findMany({ where, include: clientInclude, orderBy: { createdAt: 'desc' }, skip, take }),
    prisma.client.count({ where }),
  ]);
  res.json({ data: { items: items.map(toClientDto), total, page, pageSize } });
});

router.get('/segments', async (req, res) => {
  const organizationId = orgId(req);
  const today = todayIso(config.timezone);
  const [total, recent, birthdays, anniversaries] = await Promise.all([
    prisma.client.count({ where: { organizationId } }),
    prisma.client.count({ where: { organizationId, createdAt: { gte: fromIsoDate(addDaysIso(today, -NEW_CLIENT_DAYS)) } } }),
    upcomingOccasions(prisma, organizationId, 'dob', today, OCCASION_DAYS),
    upcomingOccasions(prisma, organizationId, 'anniversary', today, OCCASION_DAYS),
  ]);
  res.json({ data: { total, new: recent, birthdays: birthdays.length, anniversaries: anniversaries.length } });
});

router.get('/import-template', async (req, res) => {
  res.attachment('clients-import-template.xlsx').send(await buildClientTemplate());
});

router.post('/import', canImport, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an .xlsx file to upload');
  let parsed;
  try {
    parsed = await parseClientSheet(req.file.buffer);
  } catch {
    throw badRequest('Could not read the file. Upload an .xlsx file based on the sample template.');
  }

  const { rows, errors } = parsed;
  const organizationId = orgId(req);
  let created = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      for (const { data, defaulted } of rows) {
        const fields = toClientData(data);
        const existing = await tx.client.findUnique({ where: { organizationId_phone: { organizationId, phone: data.phone } } });
        if (existing) {
          // Blank cells keep what is already on file.
          const changes = Object.fromEntries(
            Object.entries(fields).filter(([key, value]) => value !== null && value !== undefined && !defaulted.includes(key)),
          );
          await tx.client.update({ where: { id: existing.id }, data: changes });
          updated += 1;
        } else {
          await tx.client.create({ data: { ...fields, organizationId, homeBranchId: req.branchId, referralCode: randomReferralCode() } });
          created += 1;
        }
      }
    },
    { timeout: 120_000 },
  );
  res.json({ data: { created, updated, errors } });
});

router.get('/:id', async (req, res) => {
  const client = await findOrgClient(req.params.id, orgId(req));
  const [followUps, enquiries] = await Promise.all([
    prisma.clientFollowUp.findMany({
      where: { clientId: client.id },
      include: { createdBy: { select: { name: true } }, branch: { select: { name: true } } },
      orderBy: [{ completedAt: { sort: 'asc', nulls: 'first' } }, { dueOn: 'desc' }],
      take: 50,
    }),
    prisma.enquiry.findMany({
      where: { clientId: client.id },
      select: { id: true, enquiryFor: true, status: true, createdAt: true, branch: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    }),
  ]);
  res.json({ data: { ...toClientDto(client), followUps: followUps.map(followUpDto), enquiries } });
});

router.post('/', validateBody(clientSchema), async (req, res) => {
  await assertAssignee(req.body.assignedToId, orgId(req));
  const client = await prisma.client.create({
    data: { ...toClientData(req.body), organizationId: orgId(req), homeBranchId: req.branchId, referralCode: randomReferralCode() },
    include: clientInclude,
  });
  res.status(201).json({ data: toClientDto(client) });
});

router.put('/:id', validateBody(clientSchema), async (req, res) => {
  await findOrgClient(req.params.id, orgId(req));
  await assertAssignee(req.body.assignedToId, orgId(req));
  const client = await prisma.client.update({ where: { id: req.params.id }, data: toClientData(req.body), include: clientInclude });
  res.json({ data: toClientDto(client) });
});

router.post('/:id/follow-ups', validateBody(clientFollowUpSchema), async (req, res) => {
  const client = await findOrgClient(req.params.id, orgId(req));
  const followUp = await prisma.clientFollowUp.create({
    data: {
      clientId: client.id,
      branchId: req.branchId,
      dueOn: fromIsoDate(req.body.dueOn),
      dueTime: req.body.dueTime,
      note: req.body.note,
      createdById: req.user.id,
    },
  });
  res.status(201).json({ data: followUpDto(followUp) });
});

router.patch('/follow-ups/:followUpId/complete', async (req, res) => {
  const followUp = await prisma.clientFollowUp.findFirst({
    where: { id: req.params.followUpId, client: { organizationId: orgId(req) } },
  });
  if (!followUp) throw notFound('Follow-up');
  const done = await prisma.clientFollowUp.update({
    where: { id: followUp.id },
    data: { completedAt: followUp.completedAt ?? new Date() },
  });
  res.json({ data: followUpDto(done) });
});

export default router;
