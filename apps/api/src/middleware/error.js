import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { fieldErrors } from '@salon/shared';
import { AppError } from '../lib/errors.js';

const SCOPE_COLUMNS = new Set(['branchId', 'organizationId', 'categoryId']);

function send(res, status, code, message, details) {
  res.status(status).json({ error: { code, message, details } });
}

export function notFoundHandler(req, res) {
  send(res, 404, 'NOT_FOUND', `No route for ${req.method} ${req.originalUrl}`);
}

// Express recognises error handlers by their four parameters.
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (err instanceof ZodError) {
    return send(res, 400, 'VALIDATION', 'Please fix the highlighted fields', fieldErrors(err));
  }
  if (err instanceof AppError) {
    return send(res, err.status, err.code, err.message, err.details);
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const columns = [].concat(err.meta?.target ?? []);
      const field = columns.find((c) => !SCOPE_COLUMNS.has(c));
      return send(res, 409, 'CONFLICT', 'A record with the same value already exists', field ? { [field]: 'Already exists' } : undefined);
    }
    if (err.code === 'P2025') return send(res, 404, 'NOT_FOUND', 'Record not found');
    if (err.code === 'P2003') return send(res, 409, 'IN_USE', 'This record is linked to other data and cannot be removed');
  }
  if (err.type === 'entity.parse.failed') return send(res, 400, 'BAD_JSON', 'Malformed JSON body');
  if (err.name === 'MulterError') return send(res, 400, 'UPLOAD', err.message);
  // Missing file under /uploads (express.static with fallthrough: false passes the raw ENOENT or a 404).
  if (req.originalUrl.startsWith('/uploads/') && (err.code === 'ENOENT' || err.status === 404 || err.statusCode === 404)) {
    return send(res, 404, 'NOT_FOUND', 'File not found');
  }

  req.log?.error({ err }, 'Unhandled error');
  send(res, 500, 'INTERNAL', 'Something went wrong. Please try again.');
}
