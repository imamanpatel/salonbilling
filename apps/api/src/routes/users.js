import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { ROLES, userCreateSchema, userUpdateSchema } from '@salon/shared';
import { prisma } from '../db.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { requireRole } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

// Superadmins manage everyone except themselves (Account page); admins manage plain users in their own branches.
const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const include = { branches: { select: { branchId: true } } };

function toDto(user) {
  return {
    id: user.id,
    name: user.name,
    username: user.username,
    role: user.role,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    branchIds: user.branches.map((b) => b.branchId),
  };
}

async function assertCanManage(actor, { role, branchIds }) {
  const validCount = await prisma.branch.count({ where: { id: { in: branchIds }, organizationId: actor.organizationId } });
  if (validCount !== branchIds.length) throw badRequest('One or more branches are invalid', { branchIds: 'Invalid branch' });
  if (actor.role === ROLES.SUPERADMIN) return;
  if (role !== ROLES.USER) throw forbidden('Only the superadmin can manage admin accounts');
  const own = new Set(actor.branches.map((b) => b.branchId));
  if (!branchIds.every((id) => own.has(id))) throw forbidden('You can only assign branches you have access to');
}

router.get('/', async (req, res) => {
  const where = { organizationId: req.user.organizationId };
  if (req.user.role !== ROLES.SUPERADMIN) {
    where.branches = { some: { branchId: { in: req.user.branches.map((b) => b.branchId) } } };
  }
  const users = await prisma.user.findMany({ where, include, orderBy: [{ isActive: 'desc' }, { name: 'asc' }] });
  res.json({ data: users.map(toDto) });
});

router.post('/', validateBody(userCreateSchema), async (req, res) => {
  await assertCanManage(req.user, req.body);
  const { branchIds, password, ...fields } = req.body;
  const user = await prisma.user.create({
    data: {
      ...fields,
      organizationId: req.user.organizationId,
      passwordHash: await bcrypt.hash(password, 12),
      branches: { create: branchIds.map((branchId) => ({ branchId })) },
    },
    include,
  });
  res.status(201).json({ data: toDto(user) });
});

router.put('/:id', validateBody(userUpdateSchema), async (req, res) => {
  const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId }, include });
  if (!target) throw notFound('User');
  if (target.role === ROLES.SUPERADMIN || target.id === req.user.id) {
    throw forbidden('Change your own details from the Account page');
  }
  await assertCanManage(req.user, { role: target.role, branchIds: target.branches.map((b) => b.branchId) });
  await assertCanManage(req.user, req.body);

  const { branchIds, password, ...fields } = req.body;
  const data = { ...fields, branches: { deleteMany: {}, create: branchIds.map((branchId) => ({ branchId })) } };
  if (password) data.passwordHash = await bcrypt.hash(password, 12);
  if (password || !fields.isActive) data.tokenVersion = { increment: 1 };

  const user = await prisma.user.update({ where: { id: target.id }, data, include });
  res.json({ data: toDto(user) });
});

export default router;
