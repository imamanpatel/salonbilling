import { Router } from 'express';
import multer from 'multer';
import { ROLES, SERVICE_GENDERS, serviceSchema, statusSchema } from '@salon/shared';
import { prisma } from '../db.js';
import { badRequest } from '../lib/errors.js';
import { findInBranch, queryString, statusWhere } from '../lib/http.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import { buildTemplate, parseServiceSheet } from '../services/serviceImport.js';

const router = Router();
const canWrite = requireRole(ROLES.SUPERADMIN, ROLES.ADMIN);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const include = { category: { select: { id: true, name: true } } };

async function assertCategory(categoryId, branchId) {
  const exists = await prisma.serviceCategory.count({ where: { id: categoryId, branchId } });
  if (!exists) throw badRequest('Pick a valid category', { categoryId: 'Pick a valid category' });
}

router.get('/', async (req, res) => {
  const q = queryString(req, 'q');
  const categoryId = queryString(req, 'categoryId');
  const gender = queryString(req, 'gender');
  const where = { branchId: req.branchId, ...statusWhere(req) };
  if (q) where.name = { contains: q, mode: 'insensitive' };
  if (categoryId) where.categoryId = categoryId;
  if (SERVICE_GENDERS.includes(gender)) where.gender = gender;

  const rows = await prisma.service.findMany({ where, include, orderBy: [{ category: { name: 'asc' } }, { name: 'asc' }] });
  res.json({ data: rows });
});

router.get('/import-template', async (req, res) => {
  res.attachment('services-import-template.xlsx').send(await buildTemplate());
});

router.post('/import', canWrite, upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an .xlsx file to upload');
  let parsed;
  try {
    parsed = await parseServiceSheet(req.file.buffer);
  } catch {
    throw badRequest('Could not read the file. Upload an .xlsx file based on the sample template.');
  }

  const { rows, errors } = parsed;
  let created = 0;
  let updated = 0;
  await prisma.$transaction(
    async (tx) => {
      const categoryIds = new Map();
      for (const name of new Set(rows.map((r) => r.categoryName))) {
        const category = await tx.serviceCategory.upsert({
          where: { branchId_name: { branchId: req.branchId, name } },
          create: { branchId: req.branchId, name },
          update: {},
        });
        categoryIds.set(name, category.id);
      }
      // Rows matching an existing service (same category + name) update it; the rest are created.
      for (const { categoryName, data } of rows) {
        const categoryId = categoryIds.get(categoryName);
        const key = { branchId_categoryId_name: { branchId: req.branchId, categoryId, name: data.name } };
        const existing = await tx.service.findUnique({ where: key });
        if (existing) {
          await tx.service.update({ where: { id: existing.id }, data });
          updated += 1;
        } else {
          await tx.service.create({ data: { ...data, categoryId, branchId: req.branchId } });
          created += 1;
        }
      }
    },
    { timeout: 60_000 },
  );
  res.json({ data: { created, updated, errors } });
});

router.post('/', canWrite, validateBody(serviceSchema), async (req, res) => {
  await assertCategory(req.body.categoryId, req.branchId);
  const row = await prisma.service.create({ data: { ...req.body, branchId: req.branchId }, include });
  res.status(201).json({ data: row });
});

router.put('/:id', canWrite, validateBody(serviceSchema), async (req, res) => {
  await findInBranch(prisma.service, req.params.id, req.branchId, 'Service');
  await assertCategory(req.body.categoryId, req.branchId);
  const row = await prisma.service.update({ where: { id: req.params.id }, data: req.body, include });
  res.json({ data: row });
});

router.patch('/:id/status', canWrite, validateBody(statusSchema), async (req, res) => {
  await findInBranch(prisma.service, req.params.id, req.branchId, 'Service');
  const row = await prisma.service.update({ where: { id: req.params.id }, data: { isActive: req.body.isActive }, include });
  res.json({ data: row });
});

export default router;
