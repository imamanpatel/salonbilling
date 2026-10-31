import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { prisma } from '../db.js';
import { forbidden, unauthorized } from '../lib/errors.js';

const SESSION_COOKIE = 'sid';

export function issueSession(res, user) {
  const token = jwt.sign({ sub: user.id, ver: user.tokenVersion }, config.jwtSecret, { expiresIn: `${config.sessionHours}h` });
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    maxAge: config.sessionHours * 3_600_000,
    path: '/',
  });
}

export function clearSession(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

/** Loads `req.user` (with `branches: [{ branchId }]`) from the session cookie. */
export async function requireAuth(req, res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  if (!token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret);
  } catch {
    throw unauthorized('Your session has expired. Please sign in again.');
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { branches: { select: { branchId: true } } },
  });
  if (!user || !user.isActive || user.tokenVersion !== payload.ver) {
    throw unauthorized('Your session has expired. Please sign in again.');
  }
  req.user = user;
  next();
}

export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) throw forbidden();
  next();
};
