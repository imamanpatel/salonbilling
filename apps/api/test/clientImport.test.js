import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { CLIENT_IMPORT_COLUMNS, parseClientSheet } from '../src/services/clientImport.js';
import { cellDate } from '../src/services/excel.js';
import { monthDayWindow } from '../src/services/occasions.js';

async function sheetWith(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clients');
  sheet.addRow(CLIENT_IMPORT_COLUMNS);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('cellDate', () => {
  it.each([
    ['31/10/2026', '2026-10-31'],
    ['1-2-1990', '1990-02-01'],
    ['2026-10-31', '2026-10-31'],
    [new Date(Date.UTC(1994, 1, 14)), '1994-02-14'],
    ['', ''],
    [null, ''],
  ])('%j -> %j', (input, expected) => {
    expect(cellDate(input)).toBe(expected);
  });

  it.each(['31/02/2026', '45/01/2000', 'next tuesday'])('rejects %j', (input) => {
    expect(cellDate(input)).toBeNull();
  });
});

describe('monthDayWindow', () => {
  it('wraps around the new year', () => {
    expect(monthDayWindow('2026-12-30', 3)).toEqual([['12-30', 0], ['12-31', 1], ['01-01', 2]]);
  });

  it('celebrates Feb 29 birthdays on Feb 28 in non-leap years', () => {
    expect(monthDayWindow('2027-02-27', 3)).toEqual([['02-27', 0], ['02-28', 1], ['02-29', 1], ['03-01', 2]]);
    expect(monthDayWindow('2028-02-28', 2)).toEqual([['02-28', 0], ['02-29', 1]]);
  });
});

describe('parseClientSheet', () => {
  it('normalises phones, Indian dates, gender and other systems\' source labels', async () => {
    const { rows, errors } = await parseClientSheet(
      await sheetWith([['Asha Verma', '+91 90000-00001', 'f', '', '14/02/1994', '', 'Client refrence', 'Mumbai']]),
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      rowNumber: 2,
      defaulted: [],
      data: { name: 'Asha Verma', phone: '+919000000001', gender: 'FEMALE', dob: '1994-02-14', anniversary: null, source: 'REFERRAL', email: null },
    });
  });

  it('marks a blank gender as defaulted so updates keep the existing value', async () => {
    const { rows } = await parseClientSheet(await sheetWith([['No Gender', '9000000002', '', '', '', '', 'Instagram', '']]));
    expect(rows[0]).toMatchObject({ defaulted: ['gender'], data: { gender: 'OTHER', source: 'INSTAGRAM' } });
  });

  it('reports bad dates, bad phones and duplicate phones by row', async () => {
    const { rows, errors } = await parseClientSheet(
      await sheetWith([
        ['Good', '9000000003', 'Male', '', '', '', '', ''],
        ['Bad date', '9000000004', 'Male', '', '45/01/2000', '', '', ''],
        ['Bad phone', '12345', 'Male', '', '', '', '', ''],
        ['Duplicate', '9000000003', 'Male', '', '', '', '', ''],
      ]),
    );
    expect(rows.map((r) => r.data.name)).toEqual(['Good']);
    expect(errors).toEqual([
      { row: 3, message: 'Date of birth: use DD/MM/YYYY' },
      { row: 4, message: 'Phone: Enter a valid phone number' },
      { row: 5, message: 'Phone 9000000003 already appears on row 2' },
    ]);
  });
});
