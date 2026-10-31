/**
 * Next sequential bill number for a branch, e.g. "MAIN-000042".
 * Call inside the transaction that creates the bill so a failed bill does not consume a number.
 */
export async function nextBillNumber(tx, branchId) {
  const counter = await tx.billCounter.upsert({
    where: { branchId },
    create: { branchId, next: 2 },
    update: { next: { increment: 1 } },
  });
  const setting = await tx.branchSetting.findUnique({ where: { branchId }, select: { billPrefix: true } });
  const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { name: true } });
  const prefix = setting?.billPrefix || branch.name.replace(/[^a-z0-9]/gi, '').slice(0, 4).toUpperCase() || 'BILL';
  return `${prefix}-${String(counter.next - 1).padStart(6, '0')}`;
}
