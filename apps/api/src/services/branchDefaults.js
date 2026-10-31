export const DEFAULT_TAXES = [
  { name: 'GST on services 18%', ratePct: 18, appliesTo: 'SERVICE' },
  { name: 'GST on services 5%', ratePct: 5, appliesTo: 'SERVICE' },
  { name: 'GST on products 18%', ratePct: 18, appliesTo: 'PRODUCT' },
  { name: 'GST on products 5%', ratePct: 5, appliesTo: 'PRODUCT' },
];

/** Settings row and standard GST rates every new branch starts with. Call inside a transaction. */
export async function createBranchDefaults(tx, branchId) {
  await tx.branchSetting.create({ data: { branchId } });
  await tx.taxRate.createMany({ data: DEFAULT_TAXES.map((tax) => ({ ...tax, branchId })) });
}
