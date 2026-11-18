import { Router } from 'express';
import { ROLES } from '@salon/shared';
import { prisma } from '../../db.js';
import { notFound } from '../../lib/errors.js';
import { requireRole } from '../../middleware/auth.js';
import { businessDate, businessRange, rangeParams, STAFF_ORDER, staffSummary } from '../../services/hr.js';

// Commission earned per staff member from bill lines (non-void bills of this branch, by business date).
export const mount = { path: '/commissions', scope: 'branch' };

const router = Router();
router.use(requireRole(ROLES.SUPERADMIN, ROLES.ADMIN));

const SERVICE_KINDS = new Set(['SERVICE', 'PACKAGE', 'MEMBERSHIP']);

// Lines are credited through BillItemStaff: a line done by several providers counts once for each of them,
// with only their share of its amount and their own commission.
const shareWhere = (req, { from, to }) => ({
  billItem: { bill: { branchId: req.branchId, status: { not: 'VOID' }, billedAt: businessRange(from, to) } },
});

const emptySummary = () => ({ servicesCount: 0, serviceSalesPaise: 0, productSalesPaise: 0, commissionPaise: 0 });

function addShare(summary, { kind, qty, sharePaise, commissionPaise }) {
  if (kind === 'SERVICE') summary.servicesCount += qty;
  if (SERVICE_KINDS.has(kind)) summary.serviceSalesPaise += sharePaise;
  if (kind === 'PRODUCT') summary.productSalesPaise += sharePaise;
  summary.commissionPaise += commissionPaise;
  return summary;
}

router.get('/', async (req, res) => {
  const range = rangeParams(req);
  const shares = await prisma.billItemStaff.findMany({
    where: shareWhere(req, range),
    select: { staffId: true, sharePaise: true, commissionPaise: true, billItem: { select: { kind: true, qty: true } } },
  });

  const byStaff = new Map();
  for (const share of shares) {
    const summary = byStaff.get(share.staffId) ?? emptySummary();
    byStaff.set(share.staffId, addShare(summary, { ...share, ...share.billItem }));
  }

  // Active service providers always appear (with zeros), plus anyone who sold something in the range.
  const staff = await prisma.staff.findMany({
    where: { OR: [{ branchId: req.branchId, isActive: true, kind: 'SERVICE_PROVIDER' }, { id: { in: [...byStaff.keys()] } }] },
    orderBy: STAFF_ORDER,
  });
  res.json({ data: staff.map((s) => ({ staff: staffSummary(s), ...(byStaff.get(s.id) ?? emptySummary()) })) });
});

router.get('/:staffId', async (req, res) => {
  const range = rangeParams(req);
  const staff = await prisma.staff.findFirst({
    where: { id: req.params.staffId, OR: [{ branchId: req.branchId }, { billItemShares: { some: { billItem: { bill: { branchId: req.branchId } } } } }] },
  });
  if (!staff) throw notFound('Staff member');

  const shares = await prisma.billItemStaff.findMany({
    where: { ...shareWhere(req, range), staffId: staff.id },
    include: {
      billItem: {
        include: {
          bill: { select: { id: true, number: true, billedAt: true } },
          _count: { select: { providers: true } },
        },
      },
    },
    orderBy: [{ billItem: { bill: { billedAt: 'desc' } } }, { billItemId: 'asc' }],
  });

  const summary = emptySummary();
  const lines = shares.map((share) => {
    const item = share.billItem;
    addShare(summary, { ...share, kind: item.kind, qty: item.qty });
    return {
      id: item.id,
      billId: item.bill.id,
      billNumber: item.bill.number,
      billedAt: item.bill.billedAt,
      date: businessDate(item.bill.billedAt),
      kind: item.kind,
      name: item.name,
      qty: item.qty,
      /** This provider's share of the line's taxable amount. */
      taxablePaise: share.sharePaise,
      /** How many providers the line was split between. */
      providerCount: item._count.providers,
      commissionPaise: share.commissionPaise,
    };
  });
  res.json({ data: { staff: staffSummary(staff), ...range, summary, lines } });
});

export default router;
