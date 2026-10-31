import { Router } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { changePasswordSchema, loginSchema, ROLES } from '@salon/shared';
import { prisma } from '../db.js';
import { badRequest, unauthorized } from '../lib/errors.js';
import { clearSession, issueSession, requireAuth } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 10,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (req, res) =>
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many failed attempts. Try again in 15 minutes.' } }),
});

// Compared against when the username does not exist, so response time does not reveal valid usernames.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser', 10);

router.post('/login', loginLimiter, validateBody(loginSchema), async (req, res) => {
  const user = await prisma.user.findUnique({ where: { username: req.body.username.toLowerCase() } });
  const passwordOk = await bcrypt.compare(req.body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !passwordOk || !user.isActive) throw unauthorized('Invalid username or password');

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  issueSession(res, user);
  res.json({ data: await sessionPayload(user.id) });
});

router.post('/logout', (req, res) => {
  clearSession(res);
  res.status(204).end();
});

router.get('/me', requireAuth, async (req, res) => {
  res.json({ data: await sessionPayload(req.user.id) });
});

router.post('/change-password', requireAuth, validateBody(changePasswordSchema), async (req, res) => {
  const ok = await bcrypt.compare(req.body.currentPassword, req.user.passwordHash);
  if (!ok) throw badRequest('Current password is incorrect', { currentPassword: 'Current password is incorrect' });

  const user = await prisma.user.update({
    where: { id: req.user.id },
    data: { passwordHash: await bcrypt.hash(req.body.newPassword, 12), tokenVersion: { increment: 1 } },
  });
  // Other sessions are now invalid; keep this one signed in.
  issueSession(res, user);
  res.status(204).end();
});

async function sessionPayload(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { organization: true, branches: { include: { branch: true } } },
  });
  const branches =
    user.role === ROLES.SUPERADMIN
      ? await prisma.branch.findMany({ where: { organizationId: user.organizationId, isActive: true }, orderBy: { name: 'asc' } })
      : user.branches.map((ub) => ub.branch).filter((b) => b.isActive).sort((a, b) => a.name.localeCompare(b.name));

  return {
    user: { id: user.id, name: user.name, username: user.username, role: user.role },
    organization: { id: user.organization.id, name: user.organization.name },
    branches: branches.map((b) => ({ id: b.id, name: b.name, salonName: b.salonName })),
  };
}

export default router;
