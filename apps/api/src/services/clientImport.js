import ExcelJS from 'exceljs';
import { clientSchema, LEAD_SOURCES } from '@salon/shared';
import { cellDate, cellText } from './excel.js';

export const CLIENT_IMPORT_COLUMNS = [
  'Name', 'Phone', 'Gender (Female/Male/Other)', 'Email', 'Date of birth (DD/MM/YYYY)', 'Anniversary (DD/MM/YYYY)', 'Source', 'Address',
];
export const MAX_CLIENT_ROWS = 10_000;

const GENDER_ALIASES = { female: 'FEMALE', f: 'FEMALE', male: 'MALE', m: 'MALE', other: 'OTHER' };
// Includes the labels other salon software exports, e.g. Easy Salon's "Client refrence" and "Cold Calling".
const SOURCE_ALIASES = {
  'walk in': 'WALK_IN', 'walk-in': 'WALK_IN', walkin: 'WALK_IN',
  referral: 'REFERRAL', reference: 'REFERRAL', 'client reference': 'REFERRAL', 'client refrence': 'REFERRAL',
  phone: 'PHONE', call: 'PHONE', 'cold calling': 'PHONE', 'on-call': 'PHONE',
  'just dial': 'JUSTDIAL',
};
const FIELD_LABELS = { name: 'Name', phone: 'Phone', gender: 'Gender', email: 'Email', dob: 'Date of birth', anniversary: 'Anniversary', address: 'Address' };

function toSource(raw) {
  if (!raw) return null;
  const lower = raw.toLowerCase();
  const upper = raw.toUpperCase().replace(/[\s-]+/g, '_');
  return SOURCE_ALIASES[lower] ?? (LEAD_SOURCES.includes(upper) ? upper : 'OTHER');
}

export async function buildClientTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clients');
  sheet.addRow(CLIENT_IMPORT_COLUMNS).font = { bold: true };
  sheet.addRow(['Asha Verma', '9000000001', 'Female', 'asha@example.com', '14/02/1994', '', 'Instagram', 'Andheri West, Mumbai']);
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/**
 * Parse an uploaded clients sheet (first worksheet, header on row 1).
 * Returns `{ rows: [{ rowNumber, data, defaulted }], errors: [{ row, message }] }`.
 * `defaulted` lists fields filled with a default because the cell was blank, so updates can keep existing values.
 */
export async function parseClientSheet(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  if (!sheet) return { rows: [], errors: [{ row: 0, message: 'The file has no sheets' }] };

  const rows = [];
  const errors = [];
  const seenPhones = new Map();

  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return;
    const cell = (i) => row.getCell(i).value;
    const [name, phone, genderRaw, email, , , sourceRaw, address] = [1, 2, 3, 4, 5, 6, 7, 8].map((i) => cellText(cell(i)));
    if (!name && !phone) return;
    if (rows.length >= MAX_CLIENT_ROWS) {
      errors.push({ row: rowNumber, message: `Only the first ${MAX_CLIENT_ROWS} rows are imported` });
      return;
    }

    const dob = cellDate(cell(5));
    const anniversary = cellDate(cell(6));
    if (dob === null || anniversary === null) {
      errors.push({ row: rowNumber, message: `${dob === null ? 'Date of birth' : 'Anniversary'}: use DD/MM/YYYY` });
      return;
    }

    const defaulted = genderRaw ? [] : ['gender'];
    const parsed = clientSchema.safeParse({
      name,
      phone,
      gender: genderRaw ? (GENDER_ALIASES[genderRaw.toLowerCase()] ?? genderRaw.toUpperCase()) : 'OTHER',
      email,
      dob,
      anniversary,
      source: toSource(sourceRaw),
      address,
    });
    if (!parsed.success) {
      const message = parsed.error.issues.map((i) => `${FIELD_LABELS[i.path[0]] ?? i.path.join('.')}: ${i.message}`).join('; ');
      errors.push({ row: rowNumber, message });
      return;
    }

    const firstRow = seenPhones.get(parsed.data.phone);
    if (firstRow) {
      errors.push({ row: rowNumber, message: `Phone ${parsed.data.phone} already appears on row ${firstRow}` });
      return;
    }
    seenPhones.set(parsed.data.phone, rowNumber);
    rows.push({ rowNumber, data: parsed.data, defaulted });
  });
  return { rows, errors };
}
