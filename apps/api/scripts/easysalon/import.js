import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { config } from '../../src/config.js';
import { prisma } from '../../src/db.js';
import { fromIsoDate, todayIso } from '../../src/lib/dates.js';
import { createBranchDefaults } from '../../src/services/branchDefaults.js';
import { randomReferralCode } from '../../src/services/clients.js';
import { buildModel } from './parse.js';

// Imports an Easy Salon export (made with export.browser.js) into one branch.
//
//   npm run import:easysalon -- --file export.json [--branch "Jaunpur"] [--dry-run] [--no-images]
//
// Safe to run again with a newer export before you go live: records get stable ids (or are matched on their
// natural key, e.g. client phone), bills and appointments already imported are left alone, and opening
// wallet/points balances and stock are reset to the values in the file. Don't re-run after you start
// billing in Sabilling, or those opening balances will overwrite the live ones.

const { values: args } = parseArgs({
  options: {
    file: { type: 'string' },
    branch: { type: 'string' },
    'dry-run': { type: 'boolean', default: false },
    'no-images': { type: 'boolean', default: false },
  },
});

const DEFAULT_ORG_NAME = 'My Salon';
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' };
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;

/** Deterministic UUID (v5 layout) so re-running the import updates the same rows instead of duplicating them. */
function stableId(...parts) {
  const hex = crypto.createHash('sha256').update(['easysalon', ...parts].join(':')).digest('hex');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function slugify(name) {
  return name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'branch';
}

function summarise(model) {
  const sum = (list, key) => list.reduce((s, x) => s + x[key], 0);
  console.log(`Branch           ${model.branch.name} (${model.branch.salonName})`);
  console.log(`Categories       ${model.categories.length}`);
  console.log(`Services         ${model.services.length} (${model.services.filter((s) => !s.isActive).length} old ones only seen on bills, imported as inactive)`);
  console.log(`Staff            ${model.staff.length} (${model.staff.filter((s) => s.isActive).length} active)`);
  console.log(`Clients          ${model.clients.length}`);
  console.log(`  wallet         ${model.clients.filter((c) => c.walletPaise).length} clients, ${rupees(sum(model.clients, 'walletPaise'))}`);
  console.log(`  reward points  ${model.clients.filter((c) => c.points).length} clients, ${sum(model.clients, 'points')} points`);
  console.log(`Products         ${model.products.length} (${model.products.filter((p) => p.stockQty).length} with stock)`);
  console.log(`Vendors          ${model.vendors.length}`);
  console.log(`Packages         ${model.packages.length}; bought by clients ${model.clientPackages.length}`);
  console.log(`Memberships      ${model.memberships.length}; given to clients ${model.clientMemberships.length}`);
  console.log(`Coupons          ${model.coupons.length}`);
  console.log(`Bills            ${model.bills.length}, total ${rupees(sum(model.bills, 'totalPaise'))}, due ${rupees(sum(model.bills, 'duePaise'))}`);
  console.log(`Appointments     ${model.appointments.length} (${model.appointments.filter((a) => a.bill).length} linked to their bill)`);
  console.log(`Enquiries        ${model.enquiries.length}`);
  console.log(`Expenses         ${model.expenses.length}, ${rupees(sum(model.expenses, 'amountPaise'))}`);
  console.log(`Feedback         ${model.feedback.length}`);
  console.log(`Images           ${model.gallery.length} gallery, ${model.offers.length} offers`);
  if (model.warnings.length) {
    console.log(`\n${model.warnings.length} notes:`);
    for (const w of model.warnings.slice(0, 40)) console.log(`  - ${w}`);
    if (model.warnings.length > 40) console.log(`  … and ${model.warnings.length - 40} more`);
  }
}

async function findBranch(org, model) {
  const name = args.branch ?? model.branch.name;
  const details = { ...model.branch, name };
  let branch = await prisma.branch.findFirst({ where: { organizationId: org.id, name } });
  if (!branch) {
    let slug = slugify(name);
    for (let n = 2; await prisma.branch.findUnique({ where: { slug } }); n++) slug = `${slugify(name)}-${n}`;
    branch = await prisma.$transaction(async (tx) => {
      const created = await tx.branch.create({ data: { organizationId: org.id, slug, ...details } });
      await createBranchDefaults(tx, created.id);
      return created;
    });
    console.log(`Created branch "${name}" (booking page /book/${slug})`);
  } else {
    branch = await prisma.branch.update({ where: { id: branch.id }, data: details });
    console.log(`Updating existing branch "${name}"`);
  }
  await prisma.branchSetting.update({ where: { branchId: branch.id }, data: model.settings });
  if (org.name === DEFAULT_ORG_NAME && model.branch.salonName) {
    await prisma.organization.update({ where: { id: org.id }, data: { name: model.branch.salonName } });
    console.log(`Renamed organisation "${DEFAULT_ORG_NAME}" to "${model.branch.salonName}"`);
  }
  return branch;
}

async function importCatalogue(branchId, model, ids) {
  const today = todayIso(config.timezone);
  for (const c of model.categories) {
    const row = await prisma.serviceCategory.upsert({
      where: { branchId_name: { branchId, name: c.name } },
      create: { branchId, name: c.name },
      update: {},
    });
    ids.category.set(c.key, row.id);
  }
  for (const s of model.services) {
    const categoryId = ids.category.get(s.categoryKey);
    const data = { gender: s.gender, durationMin: s.durationMin, pricePaise: s.pricePaise, memberPricePaise: s.memberPricePaise, rewardPoints: s.rewardPoints, isActive: s.isActive, showOnWebsite: s.isActive };
    const row = await prisma.service.upsert({
      where: { branchId_categoryId_name: { branchId, categoryId, name: s.name } },
      create: { branchId, categoryId, name: s.name, ...data },
      update: data,
    });
    ids.service.set(s, row.id);
  }
  for (const p of model.products) {
    const data = { unit: p.unit, volume: p.volume, mrpPaise: p.mrpPaise, salePricePaise: p.mrpPaise, rewardPoints: p.rewardPoints, barcode: p.barcode };
    const row = await prisma.product.upsert({ where: { branchId_name: { branchId, name: p.name } }, create: { branchId, name: p.name, ...data }, update: data });
    ids.product.set(p, row.id);
    const movementId = stableId(branchId, 'stock', p.legacyId);
    if (p.stockQty > 0) {
      const movement = { qtyChange: p.stockQty, note: 'Stock in Easy Salon on import' };
      await prisma.stockMovement.upsert({ where: { id: movementId }, create: { id: movementId, branchId, productId: row.id, reason: 'OPENING', ...movement }, update: movement });
    } else {
      await prisma.stockMovement.deleteMany({ where: { id: movementId } });
    }
  }
  for (const v of model.vendors) {
    const data = { phone: v.phone, email: v.email, address: v.address, notes: v.notes };
    await prisma.vendor.upsert({ where: { branchId_name: { branchId, name: v.name } }, create: { branchId, name: v.name, ...data }, update: data });
  }
  for (const m of model.memberships) {
    const { legacyId, name, ...data } = m;
    const row = await prisma.membershipPlan.upsert({ where: { branchId_name: { branchId, name } }, create: { branchId, name, ...data }, update: data });
    ids.membership.set(m, row.id);
  }
  for (const c of model.coupons) {
    const { legacyId, code, validTo, ...rest } = c;
    const data = { ...rest, validTo: fromIsoDate(validTo), isActive: !validTo || validTo >= today };
    await prisma.coupon.upsert({ where: { branchId_code: { branchId, code } }, create: { branchId, code, ...data }, update: data });
  }
  for (const p of model.packages) {
    const data = { pricePaise: p.pricePaise, validityDays: p.validityDays, isActive: p.isActive, description: p.description };
    const row = await prisma.package.upsert({ where: { branchId_name: { branchId, name: p.name } }, create: { branchId, name: p.name, ...data }, update: data });
    ids.package.set(p, row.id);
    await prisma.packageItem.deleteMany({ where: { packageId: row.id } });
    await prisma.packageItem.createMany({ data: p.items.map((i) => ({ packageId: row.id, serviceId: ids.service.get(i.service), qty: i.qty })) });
  }
}

async function importPeople(org, branchId, user, model, ids) {
  for (const s of model.staff) {
    const { key, phone, dob, joinedOn, ...rest } = s;
    const data = { ...rest, dob: fromIsoDate(dob), joinedOn: fromIsoDate(joinedOn) };
    const row = await prisma.staff.upsert({ where: { branchId_phone: { branchId, phone } }, create: { branchId, phone, ...data }, update: data });
    ids.staff.set(s, row.id);
  }

  let created = 0;
  for (const c of model.clients) {
    const details = {
      name: c.name,
      gender: c.gender,
      ...(c.email && { email: c.email }),
      ...(c.dob && { dob: fromIsoDate(c.dob) }),
      ...(c.anniversary && { anniversary: fromIsoDate(c.anniversary) }),
      ...(c.address && { address: c.address }),
      ...(c.source && { source: c.source }),
    };
    let row = await prisma.client.findUnique({ where: { organizationId_phone: { organizationId: org.id, phone: c.phone } } });
    if (row) {
      row = await prisma.client.update({ where: { id: row.id }, data: details });
    } else {
      const taken = c.referralCode && (await prisma.client.findUnique({ where: { referralCode: c.referralCode } }));
      row = await prisma.client.create({
        data: {
          organizationId: org.id,
          homeBranchId: branchId,
          phone: c.phone,
          referralCode: c.referralCode && !taken ? c.referralCode : randomReferralCode(),
          notes: [
            c.legacyIds.length ? `Imported from Easy Salon (client #${c.legacyIds.join(', #')})` : 'Imported from Easy Salon (from an old bill)',
            c.suspectPoints ? `Easy Salon showed ${c.suspectPoints} reward points, which looks wrong; not carried over. Add the correct balance by hand.` : null,
          ].filter(Boolean).join('. '),
          ...(c.createdAt && { createdAt: c.createdAt }),
          ...details,
        },
      });
      created++;
    }
    ids.client.set(c, row.id);

    // Opening balances: one row each, rewritten on every run.
    const walletId = stableId(branchId, 'wallet-opening', c.phone);
    const pointsId = stableId(branchId, 'points-opening', c.phone);
    if (c.walletPaise) {
      const entry = { amountPaise: c.walletPaise, note: 'Wallet balance in Easy Salon' };
      await prisma.walletEntry.upsert({ where: { id: walletId }, create: { id: walletId, clientId: row.id, branchId, reason: 'OPENING', createdById: user.id, ...entry }, update: entry });
    } else {
      await prisma.walletEntry.deleteMany({ where: { id: walletId } });
    }
    if (c.points) {
      const entry = { points: c.points, note: 'Reward points in Easy Salon' };
      await prisma.pointsEntry.upsert({ where: { id: pointsId }, create: { id: pointsId, clientId: row.id, branchId, reason: 'OPENING', createdById: user.id, ...entry }, update: entry });
    } else {
      await prisma.pointsEntry.deleteMany({ where: { id: pointsId } });
    }
  }
  return created;
}

async function importBills(branchId, user, model, ids) {
  const existing = new Map(
    (await prisma.bill.findMany({ where: { branchId, number: { in: model.bills.map((b) => b.number) } }, select: { id: true, number: true } })).map((b) => [b.number, b.id]),
  );
  const advanceFromAppointment = new Set(model.appointments.filter((a) => a.bill && a.advances.length).map((a) => a.bill));
  const packagesByBill = Map.groupBy(model.clientPackages, (cp) => cp.bill);
  const membershipsByBill = Map.groupBy(model.clientMemberships, (cm) => cm.bill);
  const cpItemId = (cp, ci) => stableId(branchId, 'client-package-item', cp.key, ci.service.name);
  let created = 0;

  for (const bill of model.bills) {
    if (existing.has(bill.number)) {
      ids.bill.set(bill, existing.get(bill.number));
      continue;
    }
    const clientId = ids.client.get(bill.client);
    const billId = stableId(branchId, 'bill', bill.legacyId);
    const payment = (p, kind) => ({ branchId, clientId, kind, method: p.method, reference: p.reference, amountPaise: p.amountPaise, receivedAt: bill.billedAt, createdById: user.id });
    const payments = bill.payments.map((p) => payment(p, 'BILL'));
    if (bill.advancePaise && !advanceFromAppointment.has(bill)) {
      payments.push(payment({ method: 'CASH', reference: 'Advance (Easy Salon)', amountPaise: bill.advancePaise }, 'ADVANCE'));
    }
    await prisma.$transaction(async (tx) => {
      await tx.bill.create({
        data: {
          id: billId,
          branchId,
          number: bill.number,
          clientId,
          billedAt: bill.billedAt,
          createdAt: bill.billedAt,
          status: bill.duePaise > 0 ? 'PARTIAL' : 'PAID',
          subtotalPaise: bill.subtotalPaise,
          discountPaise: bill.discountPaise,
          taxPaise: bill.taxPaise,
          roundOffPaise: bill.roundOffPaise,
          totalPaise: bill.totalPaise,
          paidPaise: bill.paidPaise,
          duePaise: bill.duePaise,
          couponDiscountPaise: bill.couponDiscountPaise,
          manualDiscountPaise: bill.manualDiscountPaise,
          notes: [bill.notes, `Easy Salon invoice #${bill.legacyId}`].filter(Boolean).join(' · '),
          createdById: user.id,
          payments: { create: payments },
        },
      });
      for (const cp of packagesByBill.get(bill) ?? []) {
        await tx.clientPackage.create({
          data: {
            id: stableId(branchId, 'client-package', cp.key),
            clientId,
            packageId: ids.package.get(cp.package),
            branchId,
            purchasedOn: fromIsoDate(cp.purchasedOn),
            expiresOn: fromIsoDate(cp.expiresOn),
            billId,
            createdAt: bill.billedAt,
            items: { create: cp.items.map((ci) => ({ id: cpItemId(cp, ci), serviceId: ids.service.get(ci.service), totalQty: ci.totalQty, usedQty: Math.min(ci.usedQty, ci.totalQty) })) },
          },
        });
      }
      for (const cm of membershipsByBill.get(bill) ?? []) {
        await tx.clientMembership.create({
          data: { id: stableId(branchId, 'client-membership', cm.key), clientId, planId: ids.membership.get(cm.plan), branchId, startsOn: fromIsoDate(cm.startsOn), endsOn: fromIsoDate(cm.endsOn), billId, createdAt: bill.billedAt },
        });
      }
      await tx.billItem.createMany({
        data: bill.items.map((item) => ({
          billId,
          kind: item.kind,
          name: item.fromPackage ? `${item.name} (from package ${item.fromPackage})` : item.name,
          serviceId: item.service ? ids.service.get(item.service) : null,
          productId: item.product ? ids.product.get(item.product) : null,
          packageId: item.package ? ids.package.get(item.package) : null,
          membershipPlanId: item.membership ? ids.membership.get(item.membership) : null,
          clientPackageItemId: item.clientPackageItem ? cpItemId(item.clientPackageItem.cp, item.clientPackageItem.ci) : null,
          staffId: item.staff ? ids.staff.get(item.staff) : null,
          qty: item.qty,
          unitPricePaise: item.unitPricePaise,
          discountPaise: item.discountPaise,
          taxPct: item.taxPct,
          taxPaise: item.taxPaise,
          totalPaise: item.totalPaise,
        })),
      });
    });
    ids.bill.set(bill, billId);
    if (++created % 250 === 0) console.log(`  bills: ${created}…`);
  }
  return created;
}

async function importAppointments(branchId, user, model, ids) {
  let created = 0;
  for (const appt of model.appointments) {
    const id = stableId(branchId, 'appointment', appt.legacyId);
    if (await prisma.appointment.findUnique({ where: { id }, select: { id: true } })) continue;
    const clientId = ids.client.get(appt.client);
    const billId = appt.bill ? ids.bill.get(appt.bill) : null;
    await prisma.appointment.create({
      data: {
        id,
        branchId,
        clientId,
        date: fromIsoDate(appt.date),
        startTime: appt.items.map((i) => i.startTime).sort()[0],
        endTime: appt.items.map((i) => i.endTime).sort().at(-1),
        status: appt.status,
        source: appt.source,
        notes: [appt.notes, appt.status === 'NO_SHOW' ? `Still "${appt.legacyStatus}" in Easy Salon` : null].filter(Boolean).join(' · ') || null,
        billId,
        createdById: user.id,
        createdAt: fromIsoDate(appt.bookedOn),
        items: {
          create: appt.items.map((i) => ({ serviceId: ids.service.get(i.service), staffId: i.staff ? ids.staff.get(i.staff) : null, startTime: i.startTime, endTime: i.endTime, pricePaise: i.pricePaise })),
        },
        payments: {
          create: appt.advances.map((p) => ({ branchId, clientId, billId, kind: 'ADVANCE', method: p.method, reference: p.reference, amountPaise: p.amountPaise, receivedAt: fromIsoDate(appt.bookedOn), createdById: user.id })),
        },
      },
    });
    created++;
  }
  return created;
}

async function importOther(branchId, user, model, ids) {
  for (const e of model.enquiries) {
    const id = stableId(branchId, 'enquiry', e.legacyId);
    const data = { name: e.name, phone: e.phone, email: e.email, enquiryFor: e.enquiryFor, type: e.type, followUpOn: fromIsoDate(e.followUpOn), clientId: e.client ? ids.client.get(e.client) : null };
    await prisma.enquiry.upsert({ where: { id }, create: { id, branchId, source: 'OTHER', notes: 'Imported from Easy Salon', ...data }, update: data });
  }
  for (const e of model.expenses) {
    const id = stableId(branchId, 'expense', e.legacyId);
    const { legacyId, spentOn, ...rest } = e;
    const data = { ...rest, spentOn: fromIsoDate(spentOn) };
    await prisma.expense.upsert({ where: { id }, create: { id, branchId, createdById: user.id, ...data }, update: data });
  }
  for (const f of model.feedback) {
    const id = stableId(branchId, 'feedback', f.key);
    const { key, ...data } = f;
    await prisma.feedback.upsert({ where: { id }, create: { id, branchId, ...data }, update: data });
  }
}

async function downloadImage(url, branchId, id) {
  const res = await fetch(url, { signal: AbortSignal.timeout(30_000) });
  const type = res.headers.get('content-type')?.split(';')[0];
  if (!res.ok || !IMAGE_TYPES[type]) throw new Error(`${res.status} ${type ?? 'unknown type'}`);
  const dir = path.join(config.uploadsDir, branchId);
  await fs.promises.mkdir(dir, { recursive: true });
  const file = `${id}${IMAGE_TYPES[type]}`;
  await fs.promises.writeFile(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
  return `/uploads/${branchId}/${file}`;
}

async function importImages(branchId, model) {
  let saved = 0;
  const failures = [];
  for (const [kind, urls] of [['gallery', model.gallery], ['offer', model.offers]]) {
    for (const [index, url] of urls.entries()) {
      const id = stableId(branchId, kind, url);
      const exists = kind === 'gallery' ? await prisma.galleryPhoto.findUnique({ where: { id } }) : await prisma.offer.findUnique({ where: { id } });
      if (exists) continue;
      try {
        const imageUrl = await downloadImage(url, branchId, id);
        if (kind === 'gallery') await prisma.galleryPhoto.create({ data: { id, branchId, imageUrl, sortOrder: index } });
        else await prisma.offer.create({ data: { id, branchId, title: `Offer ${index + 1}`, imageUrl, sortOrder: index } });
        saved++;
      } catch (err) {
        failures.push(`${path.basename(decodeURIComponent(url))}: ${err.message}`);
      }
    }
  }
  return { saved, failures };
}

async function main() {
  if (!args.file) throw new Error('Usage: npm run import:easysalon -- --file easysalon-export.json [--branch "Name"] [--dry-run] [--no-images]');
  const data = JSON.parse(await fs.promises.readFile(path.resolve(args.file), 'utf8'));
  const model = buildModel(data, { today: todayIso(config.timezone) });
  console.log(`Easy Salon export from ${data.exportedAt}\n`);
  summarise(model);
  if (args['dry-run']) {
    console.log('\nDry run: nothing was written.');
    return;
  }

  const orgs = await prisma.organization.findMany({ orderBy: { createdAt: 'asc' } });
  if (orgs.length !== 1) throw new Error(`Expected one organisation, found ${orgs.length}. Run npm run db:seed first.`);
  const [org] = orgs;
  const user = await prisma.user.findFirst({ where: { organizationId: org.id, role: 'SUPERADMIN', isActive: true }, orderBy: { createdAt: 'asc' } });
  if (!user) throw new Error('No active superadmin to record as the importer. Run npm run db:seed first.');

  console.log('\nImporting…');
  const started = Date.now();
  const branch = await findBranch(org, model);
  const ids = { category: new Map(), service: new Map(), product: new Map(), membership: new Map(), package: new Map(), staff: new Map(), client: new Map(), bill: new Map() };
  await importCatalogue(branch.id, model, ids);
  const newClients = await importPeople(org, branch.id, user, model, ids);
  const newBills = await importBills(branch.id, user, model, ids);
  const newAppointments = await importAppointments(branch.id, user, model, ids);
  await importOther(branch.id, user, model, ids);
  const images = args['no-images'] ? { saved: 0, failures: [] } : await importImages(branch.id, model);

  const totals = await prisma.bill.aggregate({ where: { branchId: branch.id }, _count: true, _sum: { totalPaise: true, duePaise: true } });
  console.log(`\nDone in ${Math.round((Date.now() - started) / 1000)}s.`);
  console.log(`  new clients ${newClients}, new bills ${newBills}, new appointments ${newAppointments}, images saved ${images.saved}`);
  console.log(`  branch "${branch.name}" now has ${totals._count} bills totalling ${rupees(totals._sum.totalPaise ?? 0)} (due ${rupees(totals._sum.duePaise ?? 0)})`);
  for (const f of images.failures) console.log(`  image not saved: ${f}`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
