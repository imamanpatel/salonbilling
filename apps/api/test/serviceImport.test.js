import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { buildTemplate, IMPORT_COLUMNS, parseServiceSheet } from '../src/services/serviceImport.js';

async function sheetWith(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Services');
  sheet.addRow(IMPORT_COLUMNS);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

describe('service import', () => {
  it('parses its own template', async () => {
    const { rows, errors } = await parseServiceSheet(await buildTemplate());
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      rowNumber: 2,
      categoryName: 'Hair',
      data: {
        name: 'Haircut - Women',
        gender: 'FEMALE',
        durationMin: 45,
        pricePaise: 49900,
        memberPricePaise: 44900,
        rewardPoints: 5,
        showOnWebsite: true,
        isActive: true,
      },
    });
  });

  it('defaults member price to price and gender to unisex', async () => {
    const { rows } = await parseServiceSheet(await sheetWith([['Nails', 'Manicure', '', 30, '350.50', '', '']]));
    expect(rows[0].data).toMatchObject({ gender: 'UNISEX', pricePaise: 35050, memberPricePaise: 35050, rewardPoints: 0 });
  });

  it('reports bad rows with their row number and skips blank rows', async () => {
    const { rows, errors } = await parseServiceSheet(
      await sheetWith([
        ['Hair', 'Ok service', 'Male', 20, 100, 90, 0],
        ['', '', '', '', '', '', ''],
        ['', 'No category', 'Male', 20, 100, 90, 0],
        ['Hair', 'Bad price', 'Male', 20, 'abc', '', 0],
        ['Hair', 'Too cheap member', 'Alien', 2, 100, 200, 0],
      ]),
    );
    expect(rows.map((r) => r.data.name)).toEqual(['Ok service']);
    expect(errors).toEqual([
      { row: 4, message: 'Category is required' },
      { row: 5, message: expect.stringContaining('Price') },
      { row: 6, message: expect.stringMatching(/For: .*Duration: .*/) },
    ]);
  });

  it('rejects files that are not workbooks', async () => {
    await expect(parseServiceSheet(Buffer.from('not a spreadsheet'))).rejects.toThrow();
  });
});
