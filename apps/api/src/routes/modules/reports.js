import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { collectionsQuerySchema, reportRangeSchema, salesByItemQuerySchema } from '@salon/shared/reports';
import { config } from '../../config.js';
import { prisma } from '../../db.js';
import { todayIso } from '../../lib/dates.js';
import { queryString } from '../../lib/http.js';
import { requireRole } from '../../middleware/auth.js';
import {
  buildWorkbook, clientsReport, collectionsReport, dailySummary, duesReport, enquiriesReport, profitReport, REPORT_SHEETS, REPORT_TITLES,
  salesByItem, staffReport,
} from '../../services/reports.js';

export const mount = { path: '/reports', scope: 'branch' };

// Every report answers JSON, or an Excel download with ?format=xlsx.
const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const contextOf = (req) => ({
  prisma,
  branchId: req.branchId,
  organizationId: req.branch.organizationId,
  timeZone: config.timezone,
  today: todayIso(config.timezone),
});

const optional = (req, key) => queryString(req, key) || undefined;
const rangeOf = (req) => reportRangeSchema.parse({ from: optional(req, 'from'), to: optional(req, 'to') });

async function respond(req, res, key, data, fileSuffix) {
  if (queryString(req, 'format') !== 'xlsx') return res.json({ data });
  const buffer = await buildWorkbook(REPORT_TITLES[key], REPORT_SHEETS[key](data));
  res.attachment(`${key}-${fileSuffix}.xlsx`).send(buffer);
}

const ranged = (key, run, extraSchema) =>
  router.get(`/${key}`, async (req, res) => {
    const range = rangeOf(req);
    const extra = extraSchema ? extraSchema.parse(Object.fromEntries(Object.keys(extraSchema.shape).map((k) => [k, optional(req, k)]))) : {};
    const data = await run(contextOf(req), { ...range, ...extra });
    await respond(req, res, key, data, `${range.from}-${range.to}`);
  });

ranged('daily-summary', dailySummary);
ranged('sales-by-item', salesByItem, salesByItemQuerySchema);
ranged('staff', staffReport);
ranged('collections', collectionsReport, collectionsQuerySchema);
ranged('clients', clientsReport);
ranged('enquiries', enquiriesReport);
ranged('profit', profitReport);

router.get('/dues', async (req, res) => {
  const ctx = contextOf(req);
  await respond(req, res, 'dues', await duesReport(ctx), ctx.today);
});

export default router;
