import { Router } from 'express';
import multer from 'multer';
import { ROLES } from '@salon/shared';
import { prisma } from '../../db.js';
import { badRequest } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import {
  buildOpeningBalanceTemplate, importOpeningBalances, parseOpeningBalanceSheet,
} from '../../services/openingBalanceImport.js';

// Data migration from another salon software. Clients, services and products have their own import endpoints.
export const mount = { path: '/imports', scope: 'branch' };

const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });

router.get('/opening-balances/template', async (req, res) => {
  res.attachment('opening-balances-template.xlsx').send(await buildOpeningBalanceTemplate());
});

router.post('/opening-balances', upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('Choose an .xlsx file to upload');
  let parsed;
  try {
    parsed = await parseOpeningBalanceSheet(req.file.buffer);
  } catch {
    throw badRequest('Could not read the file. Upload an .xlsx file based on the sample template.');
  }

  const result = await prisma.$transaction(
    (tx) => importOpeningBalances(tx, parsed.rows, { organizationId: req.branch.organizationId, branchId: req.branchId, userId: req.user.id }),
    { timeout: 120_000 },
  );
  const errors = [...parsed.errors, ...result.errors].sort((a, b) => a.row - b.row);
  res.json({ data: { created: result.created, updated: 0, errors } });
});

export default router;
