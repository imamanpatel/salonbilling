import { Router } from 'express';
import { ROLES } from '@salon/shared';
import {
  CHANNEL_FIELDS, isMaskedSecret, isSecretKey, KIND_PLACEHOLDERS, maskConfig, MESSAGE_CHANNELS, MESSAGE_KINDS,
  MESSAGE_STATUSES, messageTemplateSchema, messagingSettingsSchema, messagingTestSchema, reminderRuleSchema, SAMPLE_VARS,
  sendMessagesSchema, templatePreviewSchema,
} from '@salon/shared/messaging';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { zonedDayStart } from '../../jobs/clock.js';
import { addDaysIso } from '../../lib/dates.js';
import { badRequest } from '../../lib/errors.js';
import { findInBranch, pageParams, queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import { validateBody } from '../../middleware/validate.js';
import { sendMessage } from '../../services/messageProviders.js';
import {
  createTemplater, DEFAULT_TEMPLATES, messagingSettingsFor, providerFor, recipientFor, renderTemplate,
} from '../../services/messaging.js';

export const mount = { path: '/messaging', scope: 'branch' };

const router = Router();
const canManage = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const SUMMARY_DAYS = 7;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const settingsDto = (settings) => ({
  ...settings,
  smsConfig: maskConfig(settings.smsConfig),
  whatsappConfig: maskConfig(settings.whatsappConfig),
  emailConfig: maskConfig(settings.emailConfig),
});

/** Masked secrets sent back unchanged keep the stored value (only while the provider is the same). */
function keepStoredSecrets(next, stored) {
  const errors = {};
  for (const { provider, config: field } of Object.values(CHANNEL_FIELDS)) {
    const values = next[field];
    if (!values) continue;
    const previous = stored[provider] === next[provider] ? (stored[field] ?? {}) : {};
    for (const [key, value] of Object.entries(values)) {
      if (!isSecretKey(key) || !isMaskedSecret(value)) continue;
      if (previous[key]) values[key] = previous[key];
      else errors[`${field}.${key}`] = 'Enter the value again';
    }
  }
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields', errors);
  return next;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

router.get('/settings', canManage, async (req, res) => {
  res.json({ data: settingsDto(await messagingSettingsFor(prisma, req.branchId)) });
});

router.put('/settings', canManage, validateBody(messagingSettingsSchema), async (req, res) => {
  const stored = await messagingSettingsFor(prisma, req.branchId);
  const data = keepStoredSecrets(req.body, stored);
  const settings = await prisma.messagingSettings.upsert({
    where: { branchId: req.branchId },
    create: { ...data, branchId: req.branchId },
    update: data,
  });
  res.json({ data: settingsDto(settings) });
});

/** Sends right away with the saved provider; nothing is logged. */
router.post('/test', canManage, validateBody(messagingTestSchema), async (req, res) => {
  const { channel, to, body } = req.body;
  const { provider, config: providerConfig } = providerFor(await messagingSettingsFor(prisma, req.branchId), channel);
  const result = await sendMessage({ channel, provider, config: providerConfig, to, body, kind: 'CUSTOM', logger: req.log });
  res.json({ data: { ...result, provider } });
});

// ─── Templates ────────────────────────────────────────────────────────────────

router.get('/templates', async (req, res) => {
  const templates = await prisma.messageTemplate.findMany({
    where: { branchId: req.branchId },
    orderBy: [{ kind: 'asc' }, { channel: 'asc' }, { name: 'asc' }],
  });
  res.json({ data: templates });
});

router.get('/templates/defaults', async (req, res) => {
  const kinds = MESSAGE_KINDS.map((kind) => ({ kind, defaultBody: DEFAULT_TEMPLATES[kind], placeholders: KIND_PLACEHOLDERS[kind] }));
  res.json({ data: { kinds } });
});

router.post('/templates/preview', validateBody(templatePreviewSchema), async (req, res) => {
  const vars = {
    ...SAMPLE_VARS,
    salonName: req.branch.salonName,
    feedbackLink: `${config.appUrl}/feedback/sample`,
  };
  res.json({ data: { body: renderTemplate(req.body.body, vars), placeholders: KIND_PLACEHOLDERS[req.body.kind] } });
});

router.post('/templates', canManage, validateBody(messageTemplateSchema), async (req, res) => {
  const template = await prisma.messageTemplate.create({ data: { ...req.body, branchId: req.branchId } });
  res.status(201).json({ data: template });
});

router.put('/templates/:id', canManage, validateBody(messageTemplateSchema), async (req, res) => {
  await findInBranch(prisma.messageTemplate, req.params.id, req.branchId, 'Template');
  const template = await prisma.messageTemplate.update({ where: { id: req.params.id }, data: req.body });
  res.json({ data: template });
});

router.delete('/templates/:id', canManage, async (req, res) => {
  await findInBranch(prisma.messageTemplate, req.params.id, req.branchId, 'Template');
  await prisma.messageTemplate.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

// ─── Message log ──────────────────────────────────────────────────────────────

async function logWhere(req) {
  const where = { branchId: req.branchId };
  const status = queryString(req, 'status');
  const kind = queryString(req, 'kind');
  const channel = queryString(req, 'channel');
  const from = queryString(req, 'from');
  const to = queryString(req, 'to');
  const q = queryString(req, 'q');

  if (MESSAGE_STATUSES.includes(status)) where.status = status;
  if (MESSAGE_KINDS.includes(kind)) where.kind = kind;
  if (MESSAGE_CHANNELS.includes(channel)) where.channel = channel;
  if (ISO_DATE.test(from) || ISO_DATE.test(to)) {
    where.createdAt = {};
    if (ISO_DATE.test(from)) where.createdAt.gte = zonedDayStart(from, config.timezone);
    if (ISO_DATE.test(to)) where.createdAt.lt = zonedDayStart(addDaysIso(to, 1), config.timezone);
  }
  if (q) {
    const clients = await prisma.client.findMany({
      where: { organizationId: req.branch.organizationId, name: { contains: q, mode: 'insensitive' } },
      select: { id: true },
      take: 500,
    });
    where.OR = [{ recipient: { contains: q, mode: 'insensitive' } }, { clientId: { in: clients.map((c) => c.id) } }];
  }
  return where;
}

router.get('/logs', async (req, res) => {
  const { page, pageSize, skip, take } = pageParams(req);
  const where = await logWhere(req);
  const [logs, total] = await prisma.$transaction([
    prisma.messageLog.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip, take }),
    prisma.messageLog.count({ where }),
  ]);
  const clientIds = [...new Set(logs.map((log) => log.clientId).filter(Boolean))];
  const clients = clientIds.length
    ? await prisma.client.findMany({ where: { id: { in: clientIds } }, select: { id: true, name: true } })
    : [];
  const byId = new Map(clients.map((c) => [c.id, c]));
  const items = logs.map((log) => ({ ...log, client: byId.get(log.clientId) ?? null }));
  res.json({ data: { items, total, page, pageSize } });
});

router.post('/logs/:id/retry', async (req, res) => {
  const log = await findInBranch(prisma.messageLog, req.params.id, req.branchId, 'Message');
  if (log.status !== 'FAILED' && log.status !== 'SKIPPED') throw badRequest('Only failed or skipped messages can be retried');

  let { recipient } = log;
  if (!recipient && log.clientId) {
    const client = await prisma.client.findUnique({ where: { id: log.clientId }, select: { phone: true, email: true } });
    if (client) recipient = recipientFor(client, log.channel);
  }
  if (!recipient) throw badRequest(log.channel === 'EMAIL' ? 'This client has no email address' : 'This client has no phone number');

  const updated = await prisma.messageLog.update({
    where: { id: log.id },
    data: { status: 'QUEUED', recipient, scheduledFor: new Date(), attempts: 0, error: null },
  });
  res.json({ data: updated });
});

router.get('/summary', async (req, res) => {
  const since = new Date(Date.now() - SUMMARY_DAYS * 86_400_000);
  const rows = await prisma.messageLog.groupBy({
    by: ['status'],
    where: { branchId: req.branchId, createdAt: { gte: since } },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(MESSAGE_STATUSES.map((status) => [status, 0]));
  for (const row of rows) counts[row.status] = row._count._all;
  res.json({ data: { days: SUMMARY_DAYS, since, counts } });
});

// ─── Bulk send ────────────────────────────────────────────────────────────────

router.post('/send', validateBody(sendMessagesSchema), async (req, res) => {
  const { clientIds, channel, body } = req.body;
  const clients = await prisma.client.findMany({
    where: { id: { in: clientIds }, organizationId: req.branch.organizationId },
    select: { id: true, name: true, phone: true, email: true },
  });
  if (clients.length !== clientIds.length) throw badRequest('Some clients were not found', { clientIds: 'Some clients were not found' });

  const templater = createTemplater(prisma, req.branchId);
  const scheduledFor = new Date();
  const data = [];
  for (const client of clients) {
    data.push(await templater.prepare({ client, kind: 'CUSTOM', channel, body, scheduledFor, createdById: req.user.id }));
  }
  await prisma.messageLog.createMany({ data });
  const queued = data.filter((d) => d.status === 'QUEUED').length;
  res.status(201).json({ data: { queued, skipped: data.length - queued } });
});

// ─── Service reminder rules ───────────────────────────────────────────────────

const ruleInclude = { service: { select: { id: true, name: true, isActive: true } } };

async function assertActiveService(req, serviceId) {
  const service = await prisma.service.findFirst({ where: { id: serviceId, branchId: req.branchId, isActive: true } });
  if (!service) throw badRequest('Please fix the highlighted fields', { serviceId: 'Pick an active service of this branch' });
}

router.get('/reminder-rules', async (req, res) => {
  const rules = await prisma.serviceReminderRule.findMany({
    where: { branchId: req.branchId },
    include: ruleInclude,
    orderBy: [{ service: { name: 'asc' } }],
  });
  res.json({ data: rules });
});

router.post('/reminder-rules', canManage, validateBody(reminderRuleSchema), async (req, res) => {
  await assertActiveService(req, req.body.serviceId);
  const rule = await prisma.serviceReminderRule.create({ data: { ...req.body, branchId: req.branchId }, include: ruleInclude });
  res.status(201).json({ data: rule });
});

router.put('/reminder-rules/:id', canManage, validateBody(reminderRuleSchema), async (req, res) => {
  const existing = await findInBranch(prisma.serviceReminderRule, req.params.id, req.branchId, 'Reminder rule');
  if (existing.serviceId !== req.body.serviceId) await assertActiveService(req, req.body.serviceId);
  const rule = await prisma.serviceReminderRule.update({ where: { id: existing.id }, data: req.body, include: ruleInclude });
  res.json({ data: rule });
});

router.delete('/reminder-rules/:id', canManage, async (req, res) => {
  await findInBranch(prisma.serviceReminderRule, req.params.id, req.branchId, 'Reminder rule');
  await prisma.serviceReminderRule.delete({ where: { id: req.params.id } });
  res.status(204).end();
});

export default router;
