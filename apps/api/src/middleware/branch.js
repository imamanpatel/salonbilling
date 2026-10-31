import { BRANCH_HEADER, ROLES } from '@salon/shared';
import { prisma } from '../db.js';
import { badRequest, forbidden } from '../lib/errors.js';

/**
 * Resolves the active branch from the x-branch-id header into `req.branch` / `req.branchId`.
 * Superadmins may use any active branch of their organisation; others only their assigned branches.
 */
export async function requireBranch(req, res, next) {
  const branchId = req.get(BRANCH_HEADER);
  if (!branchId) throw badRequest('Select a branch first');

  const branch = await prisma.branch.findFirst({
    where: { id: branchId, organizationId: req.user.organizationId, isActive: true },
  });
  const assigned = req.user.role === ROLES.SUPERADMIN || req.user.branches.some((b) => b.branchId === branchId);
  if (!branch || !assigned) throw forbidden('You do not have access to this branch');

  req.branch = branch;
  req.branchId = branch.id;
  next();
}
