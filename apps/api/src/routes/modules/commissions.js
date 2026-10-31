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

const lineWhere = (req, { from, to }) => ({
  staffId: { not: null },
  bill: { branchId: req.branchId, status: { not: 'VOID' }, billedAt: businessRange(from, to) },
});

const emptySummary = () => ({ servicesCount: 0, serviceSalesPaise: 0, productSalesPaise: 0, commissionPaise: 0 });

function addLine(summary, { kind, qty, totalPaise, taxPaise, commissionPaise }) {
  const taxable = totalPaise - taxPaise;
  if (kind === 'SERVICE') summary.servicesCount += qty;
  if (SERVICE_KINDS.has(kind)) summary.serviceSalesPaise += taxable;
  if (kind === 'PRODUCT') summary.productSalesPaise += taxable;
  summary.commissionPaise += commissionPaise;
  return summary;
}

router.get('/', async (req, res) => {
  const range = rangeParams(req);
  const groups = await prisma.billItem.groupBy({
    by: ['staffId', 'kind'],
    where: lineWhere(req, range),
    _sum: { qty: true, totalPaise: true, taxPaise: true, commissionPaise: true },
  });

  const byStaff = new Map();
  for (const g of groups) {
    const summary = byStaff.get(g.staffId) ?? emptySummary();
    byStaff.set(g.staffId, addLine(summary, { kind: g.kind, ...g._sum }));
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
    where: { id: req.params.staffId, OR: [{ branchId: req.branchId }, { billItems: { some: { bill: { branchId: req.branchId } } } }] },
  });
  if (!staff) throw notFound('Staff member');

  const items = await prisma.billItem.findMany({
    where: { ...lineWhere(req, range), staffId: staff.id },
    include: { bill: { select: { id: true, number: true, billedAt: true } } },
    orderBy: [{ bill: { billedAt: 'desc' } }, { id: 'asc' }],
  });

  const summary = emptySummary();
  const lines = items.map((item) => {
    addLine(summary, item);
    return {
      id: item.id,
      billId: item.bill.id,
      billNumber: item.bill.number,
      billedAt: item.bill.billedAt,
      date: businessDate(item.bill.billedAt),
      kind: item.kind,
      name: item.name,
      qty: item.qty,
      taxablePaise: item.totalPaise - item.taxPaise,
      commissionPaise: item.commissionPaise,
    };
  });
  res.json({ data: { staff: staffSummary(staff), ...range, summary, lines } });
});

export default router;
