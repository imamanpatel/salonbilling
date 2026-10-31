import { describe, expect, it } from 'vitest';
import { allocate, buildModel, isoDate, money, parseBill, parseDateTime, parseLine, parseSummary, time24 } from '../scripts/easysalon/parse.js';

// Synthetic data in the shape export.browser.js produces (no real client data).

const summary = ({ total, discount = '0.00', paid, advance = '0.00', due = '0.00', mode = 'Cash' }) => [
  ['Total Qty', ': 1', 'Total :', total],
  [`Payment Mode : ${mode}`, 'Coupon Dis :', '0'],
  ['Discount :', discount],
  ['Tax :', '0'],
  ['Total :', total],
  ['Advance :', advance],
  ['Amount Paid :', paid],
  ['Amount Due :', due],
];

function rawBill(id, { clientId, phone = '9000000001', date = '14-11-2024 10:49 PM', items, total, paid, advance, due, payMode = 'Cash;', payments = null, discount }) {
  return {
    id,
    clientId,
    date: date.slice(0, 10),
    phone,
    advance: advance ?? '0.00',
    notes: '',
    payMode,
    invoice: {
      head: { 'Customer Name': 'Test Client', 'Mobile No': phone, 'Invoice No': `000${id}/INV/24-25`, 'Invoice Date': date },
      items,
      summary: summary({ total, paid, advance, due, discount }),
      letterhead: '1 Test Road, Testpur',
    },
    payments,
  };
}

function exportWith(overrides = {}) {
  return {
    source: 'easysalon',
    exportedAt: '2026-10-31T00:00:00Z',
    branch: { cells: ['Testpur', 'Test Salon', '', '9000000000', '', 'example.com', '--', '09:00 AM to 08:00 PM', 'Selected'], email: 'salon@example.com' },
    settings: { redeempoints: ['10'], redeempointsprice: ['1.00'], maxredeempoints: ['3000'] },
    categories: [{ id: 1, name: 'Hair' }],
    services: [
      { id: 10, cells: ['Haircut', 'Female', 'Hair', '30 Min', '500.00', '450.00', '50', 'Edit Delete'] },
      { id: 11, cells: ['Hair Spa', 'Female', 'Hair', '0 Min', '1000.00', '1000.00', '100', 'Edit Delete'] },
    ],
    products: [{ id: 5, cells: ['Serum', '800.00', '50 ML', '0', '', 'Edit Delete'] }],
    stock: [{ productId: 5, cells: ['1', 'Serum (50 ML)', '3 (150 ML)', '800.00', 'View history'] }],
    vendors: [],
    memberships: [{ id: 1, cells: ['Silver', '499.00', '10', '999.00', '15 %', '0 %', '0 %', '2X', '10', '180 Days', 'Edit Delete'] }],
    coupons: [{ id: 1, cells: ['save10', '10 %', '499.00', '0.00', '31-03-2025', '1', 'Edit Delete'] }],
    packages: [{ id: 3, form: { name: ['Hair Combo'], duration: ['30'], valid: ['2025-12-31'], package_price: ['1200'], 'service[]': ['sr,10', 'sr,11'], 'services[]': ['Haircut', 'Hair Spa'], 'qt[]': ['1', '1'] } }],
    providers: [{ id: 1, active: true, cells: ['', 'Asha', '9100000001', '', '', '0.00', '0.00', '1001', 'Edit'], form: { Name: ['Asha'], cont: ['9100000001'], gender: ['2'], doj: ['2024-11-01'], dob: ['0000-00-00'], month_sal: ['15000.00'], start: ['10:00 AM'], end: ['08:00 PM'], scom: ['10'], pcom: ['0'] } }],
    employees: [{ id: 1, active: true, cells: ['', 'Asha', '2001', 'Edit'], form: { name: ['Asha'], cont: ['9100000001'], gender: ['2'], doj: ['2024-11-01'] } }],
    clients: [
      { id: 1, name: 'Riya', phone: '9000000001', referralCode: 'RIYA1234', gender: 'Female', points: 40, detail: { gender: '2', dob: '1995-05-20', aniversary: '0000-00-00', leadsource: 'Walk-In', doj: '2024-11-01 10:00:00' } },
      { id: 2, name: 'Riya S', phone: '9000000001', referralCode: 'RIYA9999', gender: 'Female', points: 5, detail: { gender: '2' } },
      { id: 3, name: 'Big Points', phone: '9000000003', referralCode: 'BIGP0001', gender: 'Female', points: 99999, detail: { gender: '2' } },
    ],
    wallet: [{ clientId: 1, phone: '9000000001', amount: '150.50', date: '01-11-2024' }],
    bills: [],
    appointments: [],
    enquiries: [],
    expenses: [],
    feedback: [],
    gallery: [],
    offers: [],
    ...overrides,
  };
}

describe('Easy Salon field parsing', () => {
  it('reads money, dates and times', () => {
    expect(money('9,654.00')).toBe(965400);
    expect(money('--')).toBe(0);
    expect(isoDate('14-11-2024')).toBe('2024-11-14');
    expect(isoDate('11-Oct-2026')).toBe('2026-10-11');
    expect(isoDate('0000-00-00')).toBeNull();
    expect(time24('10:49 PM')).toBe('22:49');
    expect(time24('12:05 AM')).toBe('00:05');
    expect(time24('20:00:00')).toBe('20:00');
    expect(parseDateTime('14-11-2024 10:49 PM').toISOString()).toBe('2024-11-14T17:19:00.000Z');
  });

  it('reads percentage, flat and package-redemption lines', () => {
    expect(parseLine(['Service Hair Spa', 'Asha ,Ritu', '1499.00', '020 %', '1', '1199.20'])).toMatchObject({
      kind: 'SERVICE', name: 'Hair Spa', staffNames: ['Asha', 'Ritu'], unitPricePaise: 149900, lineDiscountPaise: 29980, netPaise: 119920,
    });
    expect(parseLine(['Service Highlight', 'Asha', '399.00', '1955.82', '18', '5226.18'])).toMatchObject({ qty: 18, lineDiscountPaise: 195582, netPaise: 522618 });
    expect(parseLine(['Service Eyebrow (PKG. DED-Hair Combo)', 'Asha', '0.00', '0', '1', '0.00'])).toMatchObject({ name: 'Eyebrow', fromPackage: 'Hair Combo', netPaise: 0 });
    expect(parseLine(['Membership Silver', 'Asha', '0.00', '0', '1', '0.00']).kind).toBe('MEMBERSHIP');
  });

  it('reads GST from the summary', () => {
    const rows = [['Total Qty', ': 1', 'Total :', '745.75'], ['Discount :', '39.25'], ['Tax Type :', 'Exclusive'], ['SGST(9%) :', '67.12'], ['CGST(9%) :', '67.12'], ['Total :', '746.00'], ['Advance :', '0.00'], ['Amount Paid :', '746.00'], ['Amount Due :', '0.00']];
    expect(parseSummary(rows)).toMatchObject({ tax: 13424, taxPct: 18, total: 74600, paid: 74600, discount: 3925 });
  });

  it('splits amounts without losing paise', () => {
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(allocate(0, [5, 5])).toEqual([0, 0]);
    expect(allocate(7, [0, 0])).toEqual([0, 0]);
  });

  it('builds a bill whose lines, discounts and payments add up', () => {
    const bill = parseBill(
      rawBill(1, {
        clientId: 1,
        items: [['Service Haircut', 'Asha', '500.00', '10 %', '1', '450.00'], ['Product Serum', '', '800.00', '0', '1', '800.00']],
        total: '1,200.00',
        discount: '50.00',
        paid: '700.00',
        advance: '500.00',
        payMode: 'Cash; Gpay;',
        payments: { 'paid[]': ['400.00', '299.90'], 'method[]': ['Cash#1', 'Gpay#11'] },
      }),
    );
    expect(bill.subtotalPaise).toBe(130000);
    // Line totals are 1250; the bill total 1200 hides a further ₹50 bill-level discount.
    expect(bill.discountPaise).toBe(10000);
    expect(bill.items.reduce((s, i) => s + i.totalPaise, 0) + bill.roundOffPaise).toBe(bill.totalPaise);
    expect(bill.paidPaise).toBe(120000);
    expect(bill.payments).toEqual([
      { method: 'CASH', reference: null, amountPaise: 40010 },
      { method: 'UPI', reference: 'Gpay', amountPaise: 29990 },
    ]);
    expect(bill.billedAt.toISOString()).toBe('2024-11-14T17:19:00.000Z');
  });
});

describe('Easy Salon export model', () => {
  it('maps catalogue, team and settings', () => {
    const model = buildModel(exportWith(), { today: '2026-10-31' });
    expect(model.branch).toMatchObject({ name: 'Testpur', salonName: 'Test Salon', gstin: null, openTime: '09:00', closeTime: '20:00', email: 'salon@example.com' });
    expect(model.settings).toEqual({ redeemPoints: 10, redeemValuePaise: 100, maxRedeemPoints: 3000 });
    expect(model.services.find((s) => s.name === 'Hair Spa').durationMin).toBe(5);
    expect(model.products[0]).toMatchObject({ unit: 'ML', volume: 50, mrpPaise: 80000, stockQty: 3 });
    expect(model.memberships[0]).toMatchObject({ pricePaise: 49900, durationDays: 180, pointsMultiplier: 2, rewardPoints: 10 });
    expect(model.coupons[0]).toMatchObject({ code: 'SAVE10', discountType: 'PERCENT', discountPct: 10, minBillPaise: 49900, maxDiscountPaise: null, validTo: '2025-03-31' });
    // The employee record with the provider's phone is the same person.
    expect(model.staff).toHaveLength(1);
    expect(model.staff[0]).toMatchObject({ kind: 'SERVICE_PROVIDER', shiftStart: '10:00', shiftEnd: '20:00', monthlySalaryPaise: 1500000, serviceCommissionPct: 10, attendanceCode: '1001' });
  });

  it('merges duplicate phones, keeps wallet balances and holds back impossible points', () => {
    const model = buildModel(exportWith(), { today: '2026-10-31' });
    expect(model.clients).toHaveLength(2);
    const riya = model.clients.find((c) => c.phone === '9000000001');
    expect(riya).toMatchObject({ legacyIds: [1, 2], name: 'Riya', points: 45, walletPaise: 15050, dob: '1995-05-20', source: 'WALK_IN', referralCode: 'RIYA1234' });
    const big = model.clients.find((c) => c.phone === '9000000003');
    expect(big).toMatchObject({ points: 0, suspectPoints: 99999 });
  });

  it('recreates deleted clients and tracks package use and appointment links', () => {
    const model = buildModel(
      exportWith({
        bills: [
          rawBill(1, { clientId: 1, date: '01-12-2024 11:00 AM', items: [['Package Hair Combo', 'Asha', '1200.00', '0', '1', '1200.00']], total: '1,200.00', paid: '1,200.00' }),
          rawBill(2, { clientId: 1, date: '05-12-2024 11:00 AM', items: [['Service Haircut (PKG. DED-Hair Combo)', 'Asha', '0.00', '0', '1', '0.00']], total: '0.00', paid: '0.00', payMode: '--' }),
          rawBill(3, { clientId: 77, phone: '9000000077', date: '06-12-2024 11:00 AM', items: [['Service Haircut', 'Asha', '500.00', '0', '1', '500.00']], total: '400.00', paid: '400.00', advance: '100.00' }),
        ],
        appointments: [
          { id: 9, bookedOn: '05-12-2024', providers: 'Asha', form: { clientid: ['77'], cont: ['9000000077'], doa: ['2024-12-06'], time: ['11:00 AM'], role: ['On-call#2'], status: ['Billed#Billed'], 'services[]': ['Haircut'], 'service[]': ['sr,10'], 'staffid0[]': ['Asha#1'], 'start_time[]': ['11:00 AM'], 'end_time[]': ['11:00 AM'], 'price[]': ['500.00'], 'disc_row[]': ['0'], 'disc_row_type[]': ['INR#1'], 'adv[]': ['100.00'], 'method[]': ['Cash#1'] } },
        ],
      }),
      { today: '2026-10-31' },
    );
    expect(model.bills).toHaveLength(3);
    expect(model.clients.find((c) => c.phone === '9000000077')).toMatchObject({ name: 'Test Client', legacyIds: [77] });
    expect(model.clientPackages).toHaveLength(1);
    expect(model.clientPackages[0].items.map((i) => `${i.service.name} ${i.usedQty}/${i.totalQty}`)).toEqual(['Haircut 1/1', 'Hair Spa 0/1']);
    const [appt] = model.appointments;
    expect(appt).toMatchObject({ status: 'BILLED', source: 'PHONE', bookedOn: '2024-12-05' });
    expect(appt.bill.number).toBe('0003/INV/24-25');
    expect(appt.items[0]).toMatchObject({ startTime: '11:00', endTime: '11:30', pricePaise: 50000 });
    expect(appt.items[0].staff.name).toBe('Asha');
  });

  it('rejects files that are not Easy Salon exports', () => {
    expect(() => buildModel({ source: 'other' }, { today: '2026-10-31' })).toThrow(/not an Easy Salon export/);
  });
});
