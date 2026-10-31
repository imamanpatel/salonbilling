import { percentOf, rupeesToPaise } from '@salon/shared';

// Turns the raw Easy Salon export (see export.browser.js) into plain records ready to write with Prisma.
// Pure functions only: no database access, so the mapping can be unit-tested and checked with --dry-run.

/** "9,654.00" -> 965400. Blank, "--" or unparseable -> 0. */
export function money(text) {
  const cleaned = String(text ?? '').replace(/[₹,\s]/g, '').replace(/^Rs\.?/i, '');
  return rupeesToPaise(cleaned) ?? 0;
}

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** "14-11-2024", "11-Oct-2026" or "2024-11-14" -> "2024-11-14"; blank or "0000-00-00" -> null. */
export function isoDate(text) {
  const value = String(text ?? '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (match) return match[1] === '0000' ? null : `${match[1]}-${match[2]}-${match[3]}`;
  match = /^(\d{1,2})-(\d{1,2}|[A-Za-z]{3})-(\d{4})/.exec(value);
  if (!match) return null;
  const month = /^\d+$/.test(match[2]) ? Number(match[2]) : MONTHS[match[2].toLowerCase()];
  if (!month) return null;
  return `${match[3]}-${String(month).padStart(2, '0')}-${match[1].padStart(2, '0')}`;
}

/** "10:49 PM" -> "22:49"; "20:00:00" -> "20:00"; anything else -> null. */
export function time24(text) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([AP]M)?$/i.exec(String(text ?? '').trim());
  if (!match) return null;
  let hours = Number(match[1]);
  const meridiem = match[3]?.toUpperCase();
  if (meridiem === 'PM' && hours < 12) hours += 12;
  if (meridiem === 'AM' && hours === 12) hours = 0;
  return `${String(hours).padStart(2, '0')}:${match[2]}`;
}

/** Local salon date + time -> Date. `offset` is the salon's UTC offset (India has no DST). */
export function localDateTime(date, time = '12:00', offset = '+05:30') {
  return date ? new Date(`${date}T${time ?? '12:00'}:00${offset}`) : null;
}

/** "14-11-2024 10:49 PM" -> Date */
export function parseDateTime(text, offset) {
  const [date, ...rest] = String(text ?? '').trim().split(/\s+/);
  return localDateTime(isoDate(date), time24(rest.join(' ')), offset);
}

export const addDays = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

const first = (form, key) => form?.[key]?.[0] ?? '';
/** "Paytm#6" -> { label: "Paytm", value: "6" } */
const option = (raw) => {
  const at = String(raw ?? '').lastIndexOf('#');
  return at < 0 ? { label: String(raw ?? '').trim(), value: '' } : { label: raw.slice(0, at).trim(), value: raw.slice(at + 1).trim() };
};
const ENTITIES = { amp: '&', quot: '"', apos: "'", '#39': "'", '#039': "'", lt: '<', gt: '>', nbsp: ' ' };
/** Easy Salon stores some names HTML-escaped ("Face &amp; Neck"), sometimes twice; decode until stable. */
export function decodeEntities(text) {
  let out = String(text ?? '');
  for (let prev; prev !== out; ) {
    prev = out;
    out = out.replace(/&(amp|quot|apos|#0?39|lt|gt|nbsp);/g, (_, name) => ENTITIES[name]);
  }
  return out;
}
const cleanName = (name) => decodeEntities(name).replace(/\s+/g, ' ').trim();
const nameKey = (name) => cleanName(name).toLowerCase();
const genderOf = (code) => (String(code) === '1' || /^male$/i.test(code) ? 'MALE' : 'FEMALE');
const digits10 = (text) => String(text ?? '').replace(/\D/g, '').slice(-10);

/** Payment method label from Easy Salon -> Sabilling PaymentMethod + reference. */
export function paymentMethod(label) {
  const text = cleanName(label);
  if (/^cash$/i.test(text)) return { method: 'CASH', reference: null };
  if (/g\s*pay|google|paytm|phone\s*pe|upi|bhim/i.test(text)) return { method: 'UPI', reference: text };
  if (/card|swipe|pos/i.test(text)) return { method: 'CARD', reference: text };
  if (/wallet/i.test(text)) return { method: 'WALLET', reference: text };
  if (/bank|neft|imps|rtgs/i.test(text)) return { method: 'BANK_TRANSFER', reference: text };
  if (/cheque|check/i.test(text)) return { method: 'CHEQUE', reference: text };
  return { method: 'OTHER', reference: text || 'Easy Salon' };
}

/**
 * One invoice line: ["Service Hair Spa", "Anzar ,Ruby", "1499.00", "020 %", "1", "1199.20"].
 * Discount is either a percentage ("020 %") or the line's total discount in rupees ("1955.82"); we only
 * trust the printed line total and derive the discount from it.
 */
export function parseLine(cells) {
  const [label, providers, rate, , qtyText, total] = cells;
  const space = label.indexOf(' ');
  const kindWord = space < 0 ? label : label.slice(0, space);
  let name = cleanName(space < 0 ? '' : label.slice(space + 1));
  const kind = { Service: 'SERVICE', Product: 'PRODUCT', Package: 'PACKAGE', Membership: 'MEMBERSHIP' }[kindWord] ?? 'SERVICE';
  let fromPackage = null;
  const redemption = /^(.*)\s+\(PKG\. DED-(.*)\)$/.exec(name);
  if (redemption) {
    name = cleanName(redemption[1]);
    fromPackage = cleanName(redemption[2]);
  }
  const qty = Math.max(1, Number.parseInt(qtyText, 10) || 1);
  const unitPricePaise = money(rate);
  const netPaise = money(total);
  const gross = unitPricePaise * qty;
  return {
    kind,
    name,
    fromPackage,
    staffNames: String(providers ?? '').split(/\s*,\s*/).map(cleanName).filter(Boolean),
    qty,
    unitPricePaise: netPaise > gross ? Math.round(netPaise / qty) : unitPricePaise,
    lineDiscountPaise: Math.max(0, gross - netPaise),
    netPaise,
  };
}

/** Invoice summary rows -> amounts in paise. `paid` excludes the appointment advance, as Easy Salon prints it. */
export function parseSummary(rows) {
  const out = { discount: 0, coupon: 0, tax: 0, taxPct: 0, total: 0, advance: 0, paid: 0, due: 0 };
  for (const cells of rows) {
    for (let i = 0; i < cells.length; i++) {
      const label = cells[i].replace(/\s*:\s*$/, '').trim();
      const value = cells[i + 1];
      if (label === 'Coupon Dis') out.coupon = money(value);
      else if (label === 'Discount') out.discount = money(value);
      else if (label === 'Tax') out.tax += money(value);
      else if (/^[CSI]GST\(\d+(?:\.\d+)?%\)$/.test(label)) {
        out.tax += money(value);
        out.taxPct += Number(/\((\d+(?:\.\d+)?)%\)/.exec(label)[1]);
      } else if (label === 'Total' && i === 0) out.total = money(value);
      else if (label === 'Advance') out.advance = money(value);
      else if (label === 'Amount Paid') out.paid = money(value);
      else if (label === 'Amount Due') out.due = money(value);
    }
  }
  return out;
}

/** Split `amount` across `weights` proportionally; remainders go to the largest weights so the parts sum exactly. */
export function allocate(amount, weights) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!amount || !sum) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((amount * w) / sum));
  let left = amount - parts.reduce((a, b) => a + b, 0);
  const order = weights.map((w, i) => i).sort((a, b) => weights[b] - weights[a]);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) parts[order[k]] += 1;
  return parts;
}

export function parseBill(raw, warnings = []) {
  const inv = raw.invoice;
  const number = inv.head['Invoice No'] || `ES-${raw.id}`;
  const lines = inv.items.map(parseLine);
  const sum = parseSummary(inv.summary);
  const subtotal = lines.reduce((s, l) => s + l.unitPricePaise * l.qty, 0);
  const lineDiscount = lines.reduce((s, l) => s + l.lineDiscountPaise, 0);
  const netLines = lines.reduce((s, l) => s + l.netPaise, 0);
  const manualDiscount = Math.max(0, sum.discount - lineDiscount);
  const billDiscount = manualDiscount + sum.coupon;
  let roundOff = sum.total - (netLines - billDiscount + sum.tax);
  let extraDiscount = 0;
  if (roundOff < -100) {
    // A bill-level discount the summary did not itemise.
    extraDiscount = -roundOff;
    roundOff = 0;
  } else if (roundOff > 100) {
    warnings.push(`Bill ${number}: total is ₹${roundOff / 100} more than its lines; kept as round-off`);
  }
  const shares = allocate(billDiscount + extraDiscount, lines.map((l) => l.netPaise));
  const taxable = lines.map((l, i) => l.netPaise - shares[i]);
  const taxes = allocate(sum.tax, taxable);
  const taxPct = sum.tax ? sum.taxPct || 18 : 0;
  const date = isoDate(inv.head['Invoice Date']) ?? isoDate(raw.date);

  const payments = [];
  if (raw.payments?.['paid[]']) {
    raw.payments['paid[]'].forEach((amount, i) => {
      const paise = money(amount);
      if (paise > 0) payments.push({ ...paymentMethod(option(raw.payments['method[]']?.[i]).label), amountPaise: paise });
    });
  } else if (sum.paid > 0) {
    const label = raw.payMode.split(';').map((s) => s.trim()).find(Boolean) ?? '';
    payments.push({ ...paymentMethod(label === '--' ? '' : label), amountPaise: sum.paid });
  }
  const gap = sum.paid - payments.reduce((s, p) => s + p.amountPaise, 0);
  if (gap && payments.length && Math.abs(gap) <= 100) {
    // Easy Salon rounds the bill but not the points/wallet part of a split payment; settle the paise on the largest part.
    payments.reduce((a, b) => (b.amountPaise > a.amountPaise ? b : a)).amountPaise += gap;
  } else if (gap) {
    warnings.push(`Bill ${number}: payments add up to ₹${(sum.paid - gap) / 100}, invoice says ₹${sum.paid / 100}`);
  }

  const advance = sum.advance || money(raw.advance);
  return {
    legacyId: raw.id,
    number,
    clientLegacyId: raw.clientId,
    clientPhone: raw.phone || inv.head['Mobile No'],
    billedAt: parseDateTime(inv.head['Invoice Date']) ?? localDateTime(date),
    date,
    items: lines.map((l, i) => ({
      ...l,
      discountPaise: l.lineDiscountPaise + shares[i],
      taxPct: taxes[i] ? taxPct : 0,
      taxPaise: taxes[i],
      totalPaise: taxable[i] + taxes[i],
    })),
    subtotalPaise: subtotal,
    discountPaise: lineDiscount + billDiscount + extraDiscount,
    couponDiscountPaise: sum.coupon,
    manualDiscountPaise: manualDiscount + extraDiscount,
    taxPaise: sum.tax,
    roundOffPaise: roundOff,
    totalPaise: sum.total,
    advancePaise: advance,
    paidPaise: sum.paid + advance,
    duePaise: sum.due,
    payments,
    notes: raw.notes || null,
  };
}

function parseAppointment(raw, today) {
  const f = raw.form;
  const date = isoDate(first(f, 'doa'));
  const items = (f['services[]'] ?? [])
    .map((name, i) => {
      const rate = money(f['price[]']?.[i]);
      const disc = f['disc_row[]']?.[i] || '0';
      const percent = option(f['disc_row_type[]']?.[i]).label === '%';
      return {
        serviceName: cleanName(name),
        serviceLegacyId: Number(String(f['service[]']?.[i] ?? '').split(',')[1]) || null,
        staffLegacyId: Number(option(f['staffid0[]']?.[i]).value) || null,
        startTime: time24(f['start_time[]']?.[i]) ?? time24(first(f, 'time')) ?? '10:00',
        endTime: time24(f['end_time[]']?.[i]),
        pricePaise: Math.max(0, rate - (percent ? percentOf(rate, Number(disc)) : money(disc))),
      };
    })
    .filter((item) => item.serviceName);
  const status = option(first(f, 'status')).label;
  return {
    legacyId: raw.id,
    clientLegacyId: Number(first(f, 'clientid')) || null,
    clientPhone: first(f, 'cont'),
    date,
    bookedOn: isoDate(raw.bookedOn) ?? date,
    source: /on-?call|phone/i.test(option(first(f, 'role')).label) ? 'PHONE' : 'WALK_IN',
    status: status === 'Billed' ? 'BILLED' : date && date >= today ? 'BOOKED' : 'NO_SHOW',
    legacyStatus: status || 'Pending',
    notes: first(f, 'notes') || null,
    items,
    advances: (f['adv[]'] ?? [])
      .map((amount, i) => ({ ...paymentMethod(option(f['method[]']?.[i]).label), amountPaise: money(amount) }))
      .filter((p) => p.amountPaise > 0),
  };
}

/** Build every record the importer writes. `today` is the salon's business date (YYYY-MM-DD). */
export function buildModel(data, { today }) {
  if (data?.source !== 'easysalon') throw new Error('This file is not an Easy Salon export (missing "source": "easysalon").');
  const warnings = [];

  // ── Branch & settings ──
  const [branchName, salonName, , phone, , website, gstin, hours] = data.branch.cells;
  const [open, close] = String(hours ?? '').split(/\s+to\s+/i).map(time24);
  const branch = {
    name: cleanName(branchName) || 'Main',
    salonName: cleanName(salonName) || cleanName(branchName),
    phone: phone || null,
    email: data.branch.email || null,
    website: website || null,
    gstin: gstin && gstin !== '--' ? gstin : null,
    address: data.bills.find((b) => b.invoice?.letterhead)?.invoice.letterhead || null,
    openTime: open ?? '10:00',
    closeTime: close ?? '20:00',
  };
  const settings = {
    redeemPoints: Number(first(data.settings, 'redeempoints')) || 1,
    redeemValuePaise: money(first(data.settings, 'redeempointsprice')) || 100,
    maxRedeemPoints: Number(first(data.settings, 'maxredeempoints')) || 0,
  };

  // ── Catalogue ──
  const categories = new Map();
  const addCategory = (name) => {
    const key = nameKey(name) || 'general';
    if (!categories.has(key)) categories.set(key, { key, name: cleanName(name) || 'General' });
    return key;
  };
  data.categories.forEach((c) => addCategory(c.name));

  const services = [];
  const serviceByLegacy = new Map();
  const serviceByName = new Map();
  for (const s of data.services) {
    const [name, gender, category, duration, price, memberPrice, points] = s.cells;
    const record = {
      legacyId: s.id,
      name: cleanName(name),
      categoryKey: addCategory(category),
      gender: /^female$/i.test(gender) ? 'FEMALE' : /^male$/i.test(gender) ? 'MALE' : 'UNISEX',
      durationMin: Math.min(720, Math.max(5, Number.parseInt(duration, 10) || 0)),
      pricePaise: money(price),
      memberPricePaise: money(memberPrice) || money(price),
      rewardPoints: Number.parseInt(points, 10) || 0,
      isActive: true,
    };
    services.push(record);
    serviceByLegacy.set(s.id, record);
    if (!serviceByName.has(nameKey(record.name))) serviceByName.set(nameKey(record.name), record);
  }
  // Services that only appear on old bills (deleted from the catalogue since) come back as inactive services.
  const OLD = 'old services (easy salon)';
  const serviceFor = (name, ratePaise) => {
    let record = serviceByName.get(nameKey(name));
    if (!record) {
      if (!categories.has(OLD)) categories.set(OLD, { key: OLD, name: 'Old services (Easy Salon)' });
      record = { legacyId: null, name: cleanName(name), categoryKey: OLD, gender: 'UNISEX', durationMin: 30, pricePaise: ratePaise, memberPricePaise: ratePaise, rewardPoints: 0, isActive: false };
      services.push(record);
      serviceByName.set(nameKey(name), record);
    }
    return record;
  };

  const products = [];
  const productByName = new Map();
  const productByLegacy = new Map();
  const UNITS = { l: 'L', ltr: 'L', ml: 'ML', gram: 'G', gm: 'G', g: 'G', kg: 'KG', mg: 'G', pkt: 'PKT', pcs: 'PCS', pc: 'PCS' };
  for (const p of data.products) {
    const [name, mrp, volumeText, reward, barcode] = p.cells;
    const vol = /^([\d.]+)\s*([A-Za-z]+)$/.exec(String(volumeText ?? '').trim());
    const unitKey = vol?.[2].toLowerCase();
    let unique = cleanName(name);
    for (let n = 2; products.some((x) => nameKey(x.name) === nameKey(unique)); n++) unique = `${cleanName(name)} (${n})`;
    const record = {
      legacyId: p.id,
      name: unique,
      unit: UNITS[unitKey] ?? 'PCS',
      volume: vol ? Number(vol[1]) / (unitKey === 'mg' ? 1000 : 1) : null,
      mrpPaise: money(mrp),
      rewardPoints: Number.parseInt(reward, 10) || 0,
      barcode: barcode || null,
      stockQty: 0,
    };
    products.push(record);
    productByLegacy.set(p.id, record);
    if (!productByName.has(nameKey(name))) productByName.set(nameKey(name), record);
  }
  for (const s of data.stock) {
    const product = productByLegacy.get(s.productId);
    if (product) product.stockQty += Number.parseInt(s.cells[2], 10) || 0;
    else warnings.push(`Stock row for unknown product "${s.cells[1]}"`);
  }

  const packages = [];
  for (const p of [...data.packages].sort((a, b) => b.id - a.id)) {
    const sourceName = cleanName(first(p.form, 'name'));
    const name = packages.some((x) => nameKey(x.name) === nameKey(sourceName)) ? `${sourceName} (#${p.id})` : sourceName;
    const itemMap = new Map();
    (p.form['service[]'] ?? []).forEach((ref, i) => {
      const svcName = cleanName(p.form['services[]']?.[i]);
      const service = serviceByLegacy.get(Number(String(ref).split(',')[1])) ?? (svcName ? serviceFor(svcName, money(p.form['price[]']?.[i])) : null);
      if (service) itemMap.set(service, (itemMap.get(service) ?? 0) + Math.max(1, Number.parseInt(p.form['qt[]']?.[i], 10) || 1));
    });
    const valid = isoDate(first(p.form, 'valid'));
    packages.push({
      legacyId: p.id,
      sourceName,
      name,
      pricePaise: money(first(p.form, 'package_price')),
      validityDays: Math.max(1, Number.parseInt(first(p.form, 'duration'), 10) || 30),
      isActive: !valid || valid >= today,
      description: valid ? `Easy Salon offer, on sale until ${valid}` : null,
      items: [...itemMap].map(([service, qty]) => ({ service, qty })),
    });
  }
  const packageFor = (name, ratePaise) => {
    const matches = packages.filter((p) => nameKey(p.sourceName) === nameKey(name));
    return matches.find((p) => p.pricePaise === ratePaise) ?? matches[0] ?? null;
  };

  const memberships = data.memberships.map((m) => {
    const [name, price, minPoints, minBill, svcDisc, prodDisc, pkgDisc, boost, purchasePoints, validity] = m.cells;
    return {
      legacyId: m.id,
      name: cleanName(name),
      description: `From Easy Salon: ${svcDisc} off services; for clients with ${minPoints} points or a ₹${money(minBill) / 100} bill`,
      pricePaise: money(price),
      durationDays: Number.parseInt(validity, 10) || 365,
      productDiscountPct: Number.parseFloat(prodDisc) || 0,
      packageDiscountPct: Number.parseFloat(pkgDisc) || 0,
      pointsMultiplier: Math.max(1, Number.parseInt(boost, 10) || 1),
      rewardPoints: Number.parseInt(purchasePoints, 10) || 0,
    };
  });
  const coupons = data.coupons.map((c) => {
    const [code, discount, minBill, maxDiscount, validTill, perUser] = c.cells;
    const percent = /%/.test(discount);
    return {
      legacyId: c.id,
      code: cleanName(code).toUpperCase(),
      discountType: percent ? 'PERCENT' : 'FLAT',
      discountPct: percent ? Number.parseFloat(discount) : null,
      discountPaise: percent ? null : money(discount),
      minBillPaise: money(minBill),
      maxDiscountPaise: money(maxDiscount) || null,
      validTo: isoDate(validTill),
      usageLimitPerClient: Number.parseInt(perUser, 10) || null,
    };
  });
  const vendors = data.vendors.map((v) => {
    const [name, phoneText, email, address] = v.cells;
    const numbers = String(phoneText ?? '').replace(/\D/g, '');
    return {
      legacyId: v.id,
      name: cleanName(name),
      phone: numbers.length === 10 ? numbers : null,
      email: /@/.test(email ?? '') ? email : null,
      address: address || null,
      notes: numbers && numbers.length !== 10 ? `Phone in Easy Salon: ${phoneText}` : null,
    };
  });

  // ── Team: service providers first; an employee with the same phone is the same person ──
  const staff = [];
  const staffByPhone = new Map();
  const staffByLegacy = new Map();
  const addStaff = (raw, kind) => {
    const f = raw.form;
    const phoneNo = first(f, 'cont').replace(/\D/g, '') || `9${String(raw.id).padStart(9, '0')}`;
    const existing = staffByPhone.get(phoneNo);
    if (existing) {
      existing.isActive ||= raw.active;
      staffByLegacy.set(`${kind}:${raw.id}`, existing);
      return;
    }
    const record = {
      key: `${kind}:${raw.id}`,
      kind: kind === 'provider' ? 'SERVICE_PROVIDER' : 'STAFF',
      name: cleanName(first(f, 'Name') || first(f, 'name')),
      phone: phoneNo,
      email: /@/.test(first(f, 'email')) ? first(f, 'email') : null,
      gender: genderOf(first(f, 'gender')),
      dob: isoDate(first(f, 'dob')),
      joinedOn: isoDate(first(f, 'doj')) ?? today,
      address: first(f, 'addr') || null,
      emergencyName: first(f, 'eperson') || null,
      emergencyPhone: first(f, 'econt') || null,
      monthlySalaryPaise: money(first(f, 'month_sal')),
      shiftStart: time24(first(f, 'start')),
      shiftEnd: time24(first(f, 'end')),
      serviceCommissionPct: Number.parseFloat(first(f, 'scom')) || 0,
      productCommissionPct: Number.parseFloat(first(f, 'pcom')) || 0,
      designation: first(f, 'ser_pro_type') || null,
      department: option(first(f, 'department')).label || null,
      attendanceCode: (kind === 'provider' ? raw.cells[7] : raw.cells.at(-2)) || null,
      isActive: raw.active,
    };
    staff.push(record);
    staffByPhone.set(phoneNo, record);
    staffByLegacy.set(record.key, record);
  };
  data.providers.forEach((p) => addStaff(p, 'provider'));
  data.employees.forEach((e) => addStaff(e, 'employee'));
  const staffByName = new Map(staff.map((s) => [nameKey(s.name), s]));

  // ── Clients: phone is unique here, so Easy Salon duplicates are merged into the oldest record ──
  const clients = [];
  const clientByPhone = new Map();
  const clientByLegacy = new Map();
  const SOURCES = { 'walk-in': 'WALK_IN', 'cold calling': 'PHONE', referral: 'REFERRAL', instagram: 'INSTAGRAM', facebook: 'FACEBOOK', google: 'GOOGLE', website: 'WEBSITE', justdial: 'JUSTDIAL' };
  for (const c of [...data.clients].sort((a, b) => a.id - b.id)) {
    const d = c.detail ?? {};
    const phoneNo = digits10(c.phone || d.cont);
    if (phoneNo.length !== 10) {
      warnings.push(`Client #${c.id} skipped: phone is not 10 digits`);
      continue;
    }
    const existing = clientByPhone.get(phoneNo);
    if (existing) {
      existing.legacyIds.push(c.id);
      existing.points += c.points;
      clientByLegacy.set(c.id, existing);
      warnings.push(`Clients #${existing.legacyIds[0]} and #${c.id} have the same phone; merged into one`);
      continue;
    }
    const [joinDate, joinTime] = String(d.doj ?? '').split(' ');
    const record = {
      legacyIds: [c.id],
      name: cleanName(c.name || d.name) || 'Client',
      phone: phoneNo,
      email: /@/.test(d.email ?? '') ? d.email.trim() : null,
      gender: d.gender ? genderOf(d.gender) : genderOf(c.gender),
      dob: isoDate(d.dob),
      anniversary: isoDate(d.aniversary),
      address: cleanName(d.address) || null,
      source: SOURCES[nameKey(d.leadsource)] ?? (d.leadsource ? 'OTHER' : null),
      referralCode: (c.referralCode || d.referral_code || '').toUpperCase() || null,
      createdAt: localDateTime(isoDate(joinDate), time24(joinTime)),
      points: c.points,
      walletPaise: 0,
    };
    clients.push(record);
    clientByPhone.set(phoneNo, record);
    clientByLegacy.set(c.id, record);
  }
  for (const w of data.wallet) {
    const client = clientByLegacy.get(w.clientId) ?? clientByPhone.get(digits10(w.phone));
    if (client) client.walletPaise += money(w.amount);
    else if (money(w.amount)) warnings.push(`Wallet balance for unknown client #${w.clientId}`);
  }
  const clientFor = (legacyId, phoneText) => clientByLegacy.get(legacyId) ?? clientByPhone.get(digits10(phoneText)) ?? null;

  // ── Bills, oldest first so package purchases come before their redemptions ──
  const bills = [];
  for (const raw of data.bills) {
    const bill = parseBill(raw, warnings);
    bill.client = clientFor(bill.clientLegacyId, bill.clientPhone);
    if (!bill.client && digits10(bill.clientPhone).length === 10) {
      // The client was deleted in Easy Salon but the bill remains: recreate them from the invoice.
      const phoneNo = digits10(bill.clientPhone);
      bill.client = {
        legacyIds: [bill.clientLegacyId].filter(Boolean),
        name: cleanName(raw.invoice.head['Customer Name']) || 'Client',
        phone: phoneNo,
        email: null,
        gender: staffByPhone.get(phoneNo)?.gender ?? 'FEMALE',
        dob: null,
        anniversary: null,
        address: null,
        source: null,
        referralCode: null,
        createdAt: bill.billedAt,
        points: 0,
        walletPaise: 0,
      };
      clients.push(bill.client);
      clientByPhone.set(phoneNo, bill.client);
      if (bill.clientLegacyId) clientByLegacy.set(bill.clientLegacyId, bill.client);
      warnings.push(`Bill ${bill.number}: its client was deleted in Easy Salon; recreated from the invoice`);
    }
    if (!bill.client) {
      warnings.push(`Bill ${bill.number} skipped: client not found`);
      continue;
    }
    for (const item of bill.items) {
      item.staff = item.staffNames.map((n) => staffByName.get(nameKey(n))).find(Boolean) ?? null;
      if (item.kind === 'SERVICE') item.service = serviceFor(item.name, item.unitPricePaise);
      if (item.kind === 'PRODUCT') {
        item.product = productByName.get(nameKey(item.name)) ?? null;
        if (!item.product) warnings.push(`Bill ${bill.number}: product "${item.name}" is not in the catalogue; kept as text`);
      }
      if (item.kind === 'PACKAGE') item.package = packageFor(item.name, item.unitPricePaise);
      if (item.kind === 'MEMBERSHIP') item.membership = memberships.find((m) => nameKey(m.name) === nameKey(item.name)) ?? null;
    }
    bills.push(bill);
  }
  bills.sort((a, b) => a.billedAt - b.billedAt || a.legacyId - b.legacyId);

  // A points balance worth more than everything the client ever spent is a data error in the old software;
  // carrying it over would let it be redeemed. Keep it out and leave a note for the salon to check.
  const spend = new Map();
  for (const bill of bills) spend.set(bill.client, (spend.get(bill.client) ?? 0) + bill.totalPaise);
  for (const client of clients) {
    const spentRupees = (spend.get(client) ?? 0) / 100;
    if (client.points > Math.max(1000, spentRupees)) {
      warnings.push(`Client #${client.legacyIds[0]} has ${client.points} points in Easy Salon but spent only ₹${spentRupees}; points not imported (see client notes)`);
      client.suspectPoints = client.points;
      client.points = 0;
    }
  }

  // ── Packages and memberships clients bought, and which package services they have used ──
  const clientPackages = [];
  const clientMemberships = [];
  for (const bill of bills) {
    bill.items.forEach((item, index) => {
      if (item.kind === 'PACKAGE' && item.package) {
        clientPackages.push({
          key: `${bill.legacyId}:${index}`,
          bill,
          client: bill.client,
          package: item.package,
          purchasedOn: bill.date,
          expiresOn: addDays(bill.date, item.package.validityDays),
          items: item.package.items.map((pi) => ({ service: pi.service, totalQty: pi.qty * item.qty, usedQty: 0 })),
        });
      }
      if (item.kind === 'MEMBERSHIP' && item.membership) {
        clientMemberships.push({ key: `${bill.legacyId}:${index}`, bill, client: bill.client, plan: item.membership, startsOn: bill.date, endsOn: addDays(bill.date, item.membership.durationDays) });
      }
      if (item.fromPackage && item.service) {
        const owned = clientPackages
          .filter((cp) => cp.client === bill.client && nameKey(cp.package.sourceName) === nameKey(item.fromPackage))
          .flatMap((cp) => cp.items.map((ci) => ({ cp, ci })))
          .find(({ ci }) => ci.service === item.service && ci.usedQty < ci.totalQty);
        if (owned) {
          owned.ci.usedQty += item.qty;
          item.clientPackageItem = owned;
        }
      }
    });
  }

  // ── Appointments, linked to the bill they became when that is unambiguous ──
  const appointments = [];
  const linkedBills = new Set();
  for (const raw of data.appointments) {
    const appt = parseAppointment(raw, today);
    appt.client = clientFor(appt.clientLegacyId, appt.clientPhone);
    if (!appt.client || !appt.date || !appt.items.length) {
      warnings.push(`Appointment #${raw.id} skipped: ${appt.client ? 'no date or services' : 'client not found'}`);
      continue;
    }
    for (const item of appt.items) {
      item.service = serviceByLegacy.get(item.serviceLegacyId) ?? serviceFor(item.serviceName, item.pricePaise);
      item.staff = staffByLegacy.get(`provider:${item.staffLegacyId}`) ?? null;
      if (!item.endTime || item.endTime <= item.startTime) {
        const [h, m] = item.startTime.split(':').map(Number);
        const end = Math.min(23 * 60 + 59, h * 60 + m + Math.max(item.service.durationMin, 15));
        item.endTime = `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}`;
      }
    }
    const advance = appt.advances.reduce((s, p) => s + p.amountPaise, 0);
    if (appt.status === 'BILLED') {
      const candidates = bills.filter((b) => b.client === appt.client && !linkedBills.has(b) && b.date >= appt.date && b.date <= addDays(appt.date, 60));
      appt.bill = (advance ? candidates.find((b) => b.advancePaise === advance) : candidates.find((b) => b.date === appt.date && !b.advancePaise)) ?? null;
      if (appt.bill) linkedBills.add(appt.bill);
    }
    appointments.push(appt);
  }

  const enquiries = data.enquiries
    .map((e) => {
      const [name, email, phoneText, follow, type, enquiryFor] = e.cells;
      const phoneNo = digits10(phoneText);
      return {
        legacyId: e.id,
        name: cleanName(name),
        phone: phoneNo,
        email: /@/.test(email ?? '') ? email : null,
        followUpOn: isoDate(follow),
        type: { hot: 'HOT', warm: 'WARM' }[nameKey(type)] ?? 'COLD',
        enquiryFor: cleanName(String(enquiryFor ?? '').replace(/^Service\s+/, '')) || 'General',
        client: clientByPhone.get(phoneNo) ?? null,
      };
    })
    .filter((e) => e.legacyId && e.phone.length === 10);

  const expenses = data.expenses
    .map((e) => {
      const [date, type, amount, mode, recipient, paidBy] = e.cells;
      return {
        legacyId: e.id,
        spentOn: isoDate(date),
        category: cleanName(type) || 'General',
        amountPaise: money(amount),
        method: paymentMethod(mode).method,
        paidTo: recipient || null,
        description: paidBy ? `Paid by ${paidBy}` : null,
      };
    })
    .filter((e) => e.spentOn && e.amountPaise > 0);

  const RATING = { excellent: 5, 'very good': 4, good: 3, average: 2, poor: 1, bad: 1 };
  const rating = (word) => RATING[nameKey(word)] ?? (Math.min(5, Number.parseInt(word, 10)) || null);
  const feedback = data.feedback.map((f) => {
    const [num, date, name, , review, experience, , support, satisfaction, serviceRating, suggestion, action] = f.cells;
    return {
      key: `${num}:${date}:${name}`,
      createdAt: localDateTime(isoDate(date)),
      name: cleanName(name) || 'Client',
      rating: rating(satisfaction) ?? rating(review) ?? 5,
      serviceRating: rating(serviceRating),
      staffRating: rating(support),
      ambienceRating: rating(experience),
      comment: [review, suggestion].filter(Boolean).join(' — ') || null,
      isApproved: /approved/i.test(action ?? ''),
    };
  });

  return {
    branch,
    settings,
    categories: [...categories.values()],
    services,
    products,
    vendors,
    memberships,
    coupons,
    packages,
    staff,
    clients,
    bills,
    clientPackages,
    clientMemberships,
    appointments,
    enquiries,
    expenses,
    feedback,
    gallery: data.gallery ?? [],
    offers: data.offers ?? [],
    warnings,
  };
}
