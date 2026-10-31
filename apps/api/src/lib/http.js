import { notFound } from './errors.js';

/** A single string query param; repeated (array) values are ignored. */
export function queryString(req, key) {
  const value = req.query[key];
  return typeof value === 'string' ? value.trim() : '';
}

/** `?page=&pageSize=` (1-based, page size capped at 100) as Prisma skip/take plus the echoed values. */
export function pageParams(req, defaultSize = 25) {
  const page = Math.max(1, Number.parseInt(queryString(req, 'page'), 10) || 1);
  const pageSize = Math.min(100, Math.max(1, Number.parseInt(queryString(req, 'pageSize'), 10) || defaultSize));
  return { page, pageSize, skip: (page - 1) * pageSize, take: pageSize };
}

/** `?status=active|inactive|all` (default active) as a Prisma where fragment. */
export function statusWhere(req) {
  const status = queryString(req, 'status') || 'active';
  if (status === 'all') return {};
  return { isActive: status !== 'inactive' };
}

/** Load a branch-owned row or throw 404, so ids from other branches are never reachable. */
export async function findInBranch(delegate, id, branchId, label) {
  const row = await delegate.findFirst({ where: { id, branchId } });
  if (!row) throw notFound(label);
  return row;
}
