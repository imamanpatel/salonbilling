import ExcelJS from 'exceljs';
import { phone as phoneSchema, rupeesToPaise } from '@salon/shared';
import { nextBillNumber } from './billNumbers.js';
import { cellText } from './excel.js';

// Wallet balances, reward points and pending dues carried over from another salon software.

export const OPENING_BALANCE_COLUMNS = ['Phone', 'Wallet balance (₹)', 'Reward points', 'Pending due (₹)', 'Note'];
export const MAX_OPENING_ROWS = 10_000;

export async function buildOpeningBalanceTemplate() {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Opening balances');
  sheet.addRow(OPENING_BALANCE_COLUMNS).font = { bold: true };
  sheet.addRow(['9000000001', 1500, 120, 800, 'Balance from old software']);
  sheet.columns.forEach((column) => {
    column.width = 24;
  });
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Blank -> 0; "1,500.50" -> 150050; invalid or negative -> null. */
function amountCell(value) {
  const raw = value && typeof value === 'object' && 'result' in value ? value.result : value;
  const text = cellText(raw);
  if (!text) return 0;
  const paise = rupeesToPaise(typeof raw === 'number' ? raw : text);
  return paise === null || paise < 0 ? null : paise;
}

function pointsCell(value) {
  const text = cellText(value).replace(/,/g, '');
  if (!text) return 0;
  return /^\d+$/.test(text) ? Number(text) : null;
}

/**
 * Parse an uploaded opening-balance sheet (first worksheet, header on row 1).
 * Returns `{ rows: [{ rowNumber, phone, walletPaise, points, duePaise, note }], errors: [{ row, message }] }`.
 */
export async function parseOpeningBalanceSheet(buffer) {
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
    const rawPhone = cellText(cell(1));
    if (!rawPhone && [2, 3, 4].every((i) => !cellText(cell(i)))) return;
    if (rows.length >= MAX_OPENING_ROWS) {
      errors.push({ row: rowNumber, message: `Only the first ${MAX_OPENING_ROWS} rows are imported` });
      return;
    }

    const phone = phoneSchema.safeParse(rawPhone);
    if (!phone.success) {
      errors.push({ row: rowNumber, message: 'Phone: Enter a valid phone number' });
      return;
    }
    const walletPaise = amountCell(cell(2));
    const points = pointsCell(cell(3));
    const duePaise = amountCell(cell(4));
    const problems = [
      walletPaise === null && 'Wallet balance: enter an amount in rupees',
      points === null && 'Reward points: enter a whole number',
      duePaise === null && 'Pending due: enter an amount in rupees',
    ].filter(Boolean);
    if (problems.length) {
      errors.push({ row: rowNumber, message: problems.join('; ') });
      return;
    }
    if (!walletPaise && !points && !duePaise) {
      errors.push({ row: rowNumber, message: 'Nothing to import: wallet, points and due are all zero' });
      return;
    }

    const firstRow = seenPhones.get(phone.data);
    if (firstRow) {
      errors.push({ row: rowNumber, message: `Phone ${phone.data} already appears on row ${firstRow}` });
      return;
    }
    seenPhones.set(phone.data, rowNumber);
    rows.push({ rowNumber, phone: phone.data, walletPaise, points, duePaise, note: cellText(cell(5)).slice(0, 255) || null });
  });
  return { rows, errors };
}

/**
 * Write parsed rows inside transaction `tx`. Clients must already exist (matched by phone in the organisation),
 * and each client's opening balance can only be imported once.
 * Returns `{ created, errors }` (`created` = clients updated).
 */
export async function importOpeningBalances(tx, rows, { organizationId, branchId, userId }) {
  const errors = [];
  let created = 0;
  for (const { rowNumber, phone, walletPaise, points, duePaise, note } of rows) {
    const client = await tx.client.findUnique({ where: { organizationId_phone: { organizationId, phone } }, select: { id: true } });
    if (!client) {
      errors.push({ row: rowNumber, message: `No client with phone ${phone}. Import clients first.` });
      continue;
    }
    const [wallet, reward, dues] = await Promise.all([
      tx.walletEntry.count({ where: { clientId: client.id, reason: 'OPENING' } }),
      tx.pointsEntry.count({ where: { clientId: client.id, reason: 'OPENING' } }),
      tx.billItem.count({ where: { kind: 'OPENING_BALANCE', bill: { clientId: client.id } } }),
    ]);
    if (wallet + reward + dues > 0) {
      errors.push({ row: rowNumber, message: 'Opening balance already imported for this client' });
      continue;
    }

    const entry = { clientId: client.id, branchId, note: note ?? 'Opening balance', createdById: userId };
    if (walletPaise > 0) await tx.walletEntry.create({ data: { ...entry, amountPaise: walletPaise, reason: 'OPENING' } });
    if (points > 0) await tx.pointsEntry.create({ data: { ...entry, points, reason: 'OPENING' } });
    if (duePaise > 0) {
      await tx.bill.create({
        data: {
          branchId,
          number: await nextBillNumber(tx, branchId),
          clientId: client.id,
          status: 'PARTIAL',
          subtotalPaise: duePaise,
          discountPaise: 0,
          taxPaise: 0,
          totalPaise: duePaise,
          paidPaise: 0,
          duePaise,
          notes: note ?? 'Opening balance',
          createdById: userId,
          items: {
            create: {
              kind: 'OPENING_BALANCE',
              name: 'Opening balance',
              qty: 1,
              unitPricePaise: duePaise,
              discountPaise: 0,
              taxPaise: 0,
              totalPaise: duePaise,
            },
          },
        },
      });
    }
    created += 1;
  }
  return { created, errors };
}
