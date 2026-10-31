import ExcelJS from 'exceljs';
import { rupeesToPaise, serviceSchema } from '@salon/shared';
import { cellText } from './excel.js';

export const IMPORT_COLUMNS = ['Category', 'Service name', 'For (Female/Male/Unisex)', 'Duration (min)', 'Price (₹, excl. tax)', 'Member price (₹)', 'Reward points'];
export const MAX_IMPORT_ROWS = 2000;

const GENDER_ALIASES = { female: 'FEMALE', f: 'FEMALE', male: 'MALE', m: 'MALE', unisex: 'UNISEX', both: 'UNISEX', 'male & female': 'UNISEX', '': 'UNISEX' };
const FIELD_LABELS = { name: 'Service name', gender: 'For', durationMin: 'Duration', pricePaise: 'Price', memberPricePaise: 'Member price', rewardPoints: 'Reward points' };

// Category is resolved after parsing; this placeholder only satisfies the schema's uuid check.
const PLACEHOLDER_CATEGORY_ID = '00000000-0000-4000-8000-000000000000';

export async function buildTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Services');
  sheet.addRow(IMPORT_COLUMNS).font = { bold: true };
  sheet.addRow(['Hair', 'Haircut - Women', 'Female', 45, 499, 449, 5]);
  sheet.addRow(['Skin', 'Classic facial', 'Unisex', 60, 1200, 1000, 10]);
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Parse an uploaded services sheet (first worksheet, header on row 1).
 * Returns valid rows as `{ rowNumber, categoryName, data }` (data lacks categoryId) and per-row errors.
 */
export async function parseServiceSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: 0, message: 'The file has no sheets' }] };

  const rows = [];
  const errors = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const [categoryName, name, genderRaw, duration, price, memberPrice, points] = [1, 2, 3, 4, 5, 6, 7].map((i) => cellText(row.getCell(i).value));
    if (!categoryName && !name) return;
    if (!categoryName) {
      errors.push({ row: rowNumber, message: 'Category is required' });
      return;
    }
    if (rows.length >= MAX_IMPORT_ROWS) {
      errors.push({ row: rowNumber, message: `Only the first ${MAX_IMPORT_ROWS} rows are imported` });
      return;
    }

    const pricePaise = rupeesToPaise(price);
    const parsed = serviceSchema.safeParse({
      categoryId: PLACEHOLDER_CATEGORY_ID,
      name,
      gender: GENDER_ALIASES[genderRaw.toLowerCase()] ?? genderRaw.toUpperCase(),
      durationMin: duration,
      pricePaise,
      memberPricePaise: memberPrice ? rupeesToPaise(memberPrice) : pricePaise,
      rewardPoints: points || 0,
    });
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${FIELD_LABELS[i.path[0]] ?? i.path.join('.')}: ${i.message}`).join('; ');
      errors.push({ row: rowNumber, message });
      return;
    }
    const { categoryId, ...data } = parsed.data;
    rows.push({ rowNumber, categoryName, data });
  });
  return { rows, errors };
}
