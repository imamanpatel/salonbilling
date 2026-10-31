import ExcelJS from 'exceljs';
import { rupeesToPaise } from '@salon/shared';
import { productSchema } from '@salon/shared/inventory';
import { cellText } from './excel.js';

export const PRODUCT_IMPORT_COLUMNS = ['Name', 'Brand', 'Barcode', 'Unit', 'Volume', 'MRP (₹)', 'Sale price (₹)', 'Cost price (₹)', 'Opening stock'];
export const MAX_PRODUCT_IMPORT_ROWS = 2000;

const UNIT_ALIASES = {
  '': 'PCS', pcs: 'PCS', pc: 'PCS', piece: 'PCS', pieces: 'PCS', nos: 'PCS', no: 'PCS', unit: 'PCS', units: 'PCS',
  ml: 'ML', l: 'L', ltr: 'L', litre: 'L', liter: 'L', g: 'G', gm: 'G', gms: 'G', gram: 'G', grams: 'G',
  kg: 'KG', kgs: 'KG', pkt: 'PKT', pack: 'PKT', packet: 'PKT', packets: 'PKT',
};
const FIELD_LABELS = {
  name: 'Name', brand: 'Brand', barcode: 'Barcode', unit: 'Unit', volume: 'Volume', mrpPaise: 'MRP',
  salePricePaise: 'Sale price', costPricePaise: 'Cost price', openingStock: 'Opening stock',
};

export async function buildProductTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Products');
  sheet.addRow(PRODUCT_IMPORT_COLUMNS).font = { bold: true };
  sheet.addRow(['Argan hair serum', 'Moroccan Gold', '8901234567890', 'ML', 100, 899, 799, 450, 12]);
  sheet.addRow(['Bleach cream', 'Oxy', '', 'G', 250, 320, 320, 180, 5]);
  sheet.columns.forEach((column) => {
    column.width = 20;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// A cell that is not blank and not a valid amount is passed through as text so the schema reports it.
const money = (text) => (text === '' ? undefined : (rupeesToPaise(text) ?? text));

/**
 * Parse an uploaded products sheet (first worksheet, header on row 1).
 * Returns valid rows as `{ rowNumber, data, provided }` and per-row errors. `data` is productSchema output;
 * `provided` lists the fields whose cells were filled in, so updates of existing products keep the rest.
 */
export async function parseProductSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: 0, message: 'The file has no sheets' }] };

  const rows = [];
  const errors = [];
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cells = PRODUCT_IMPORT_COLUMNS.map((_, i) => cellText(row.getCell(i + 1).value));
    if (cells.every((c) => c === '')) return;
    const [name, brand, barcode, unitRaw, volume, mrp, sale, cost, opening] = cells;
    if (rows.length >= MAX_PRODUCT_IMPORT_ROWS) {
      errors.push({ row: rowNumber, message: `Only the first ${MAX_PRODUCT_IMPORT_ROWS} rows are imported` });
      return;
    }

    const mrpPaise = money(mrp) ?? null;
    const input = {
      name,
      brand,
      barcode,
      unit: UNIT_ALIASES[unitRaw.toLowerCase()] ?? unitRaw.toUpperCase(),
      volume,
      mrpPaise,
      // A blank sale price sells at MRP.
      salePricePaise: money(sale) ?? (Number.isInteger(mrpPaise) ? mrpPaise : 0),
      costPricePaise: money(cost),
      openingStock: opening || undefined,
    };
    const parsed = productSchema.safeParse(input);
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${FIELD_LABELS[i.path[0]] ?? i.path.join('.')}: ${i.message}`).join('; ');
      errors.push({ row: rowNumber, message });
      return;
    }
    const provided = ['name', 'mrpPaise', 'salePricePaise'];
    if (brand) provided.push('brand');
    if (barcode) provided.push('barcode');
    if (unitRaw) provided.push('unit');
    if (volume) provided.push('volume');
    if (cost) provided.push('costPricePaise');
    rows.push({ rowNumber, data: parsed.data, provided });
  });
  return { rows, errors };
}
