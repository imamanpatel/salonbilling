import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import ExcelJS from 'exceljs';
import { CLIENT_IMPORT_COLUMNS } from '../src/services/clientImport.js';
import { buildTemplate } from '../src/services/serviceImport.js';

const PASSWORD = 'Passw0rd!';

// The API computes "today" in Asia/Kolkata (BUSINESS_TIMEZONE default); tests must agree.
const istToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const shiftIso = (iso, days) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
const birthdayIn = (days) => {
  const monthDay = shiftIso(istToday(), days).slice(5);
  return `${monthDay === '02-29' ? 1996 : 1995}-${monthDay}`;
};

async function clientSheet(rows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Clients');
  sheet.addRow(CLIENT_IMPORT_COLUMNS);
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

// Requires TEST_DATABASE_URL (apps/api/.env.test) pointing at a *_test database; it is wiped.
describe.skipIf(!process.env.TEST_DATABASE_URL)('API integration', () => {
  let app;
  let prisma;
  let fx;

  beforeAll(async () => {
    ({ prisma } = await import('../src/db.js'));
    const { createApp } = await import('../src/app.js');
    app = createApp();
    fx = await seedFixtures(prisma);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  async function login(username) {
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ username, password: PASSWORD }).expect(200);
    return agent;
  }

  describe('auth', () => {
    it('rejects a wrong password with a generic message', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'desk', password: 'nope' });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid username or password');
    });

    it('rejects unknown usernames the same way', async () => {
      const res = await request(app).post('/api/auth/login').send({ username: 'ghost', password: PASSWORD });
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid username or password');
    });

    it('lists only assigned branches for a user, all for the superadmin', async () => {
      const desk = await login('desk');
      expect((await desk.get('/api/auth/me')).body.data.branches.map((b) => b.name)).toEqual(['A1']);

      const boss = await login('boss');
      expect((await boss.get('/api/auth/me')).body.data.branches.map((b) => b.name)).toEqual(['A1', 'A2']);
    });

    it('invalidates other sessions after a password change', async () => {
      const first = await login('rotate');
      const second = await login('rotate');
      await first.post('/api/auth/change-password').send({ currentPassword: PASSWORD, newPassword: 'N3wPassword!' }).expect(204);
      await first.get('/api/auth/me').expect(200);
      await second.get('/api/auth/me').expect(401);
    });
  });

  describe('branch scoping', () => {
    it('requires a branch header', async () => {
      const desk = await login('desk');
      const res = await desk.get('/api/services');
      expect(res.status).toBe(400);
    });

    it('blocks branches the user is not assigned to and other organisations', async () => {
      const desk = await login('desk');
      await desk.get('/api/services').set(BRANCH_HEADER, fx.a2).expect(403);
      const boss = await login('boss');
      await boss.get('/api/services').set(BRANCH_HEADER, fx.b1).expect(403);
    });
  });

  describe('services', () => {
    it('lets admins create categories and services, but not plain users', async () => {
      const desk = await login('desk');
      await desk.post('/api/service-categories').set(BRANCH_HEADER, fx.a1).send({ name: 'Hair' }).expect(403);

      const admin = await login('admin');
      const category = await admin.post('/api/service-categories').set(BRANCH_HEADER, fx.a1).send({ name: 'Hair' }).expect(201);
      const dup = await admin.post('/api/service-categories').set(BRANCH_HEADER, fx.a1).send({ name: 'Hair' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ name: 'Already exists' });

      const service = await admin
        .post('/api/services')
        .set(BRANCH_HEADER, fx.a1)
        .send({ categoryId: category.body.data.id, name: 'Haircut', gender: 'FEMALE', durationMin: 45, pricePaise: 49900, memberPricePaise: 44900 })
        .expect(201);
      expect(service.body.data).toMatchObject({ name: 'Haircut', pricePaise: 49900, category: { name: 'Hair' } });

      // Branch A2 cannot see A1's catalogue.
      const boss = await login('boss');
      const other = await boss.get('/api/services').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(other.body.data).toEqual([]);
    });

    it('returns field errors for invalid input', async () => {
      const admin = await login('admin');
      const res = await admin.post('/api/services').set(BRANCH_HEADER, fx.a1).send({ name: '', pricePaise: -1 });
      expect(res.status).toBe(400);
      expect(res.body.error.details).toMatchObject({ name: expect.any(String), pricePaise: expect.any(String), categoryId: expect.any(String) });
    });

    it('imports services from the Excel template', async () => {
      const admin = await login('admin');
      const res = await admin
        .post('/api/services/import')
        .set(BRANCH_HEADER, fx.a1)
        .attach('file', await buildTemplate(), 'services.xlsx')
        .expect(200);
      expect(res.body.data).toMatchObject({ created: 2, updated: 0, errors: [] });

      const again = await admin.post('/api/services/import').set(BRANCH_HEADER, fx.a1).attach('file', await buildTemplate(), 'services.xlsx');
      expect(again.body.data).toMatchObject({ created: 0, updated: 2 });
    });
  });

  describe('users', () => {
    it('stops admins from creating admins or assigning foreign branches', async () => {
      const admin = await login('admin');
      const base = { name: 'New', password: PASSWORD, isActive: true };
      await admin.post('/api/users').send({ ...base, username: 'new-admin', role: 'ADMIN', branchIds: [fx.a1] }).expect(403);
      await admin.post('/api/users').send({ ...base, username: 'new-a2', role: 'USER', branchIds: [fx.a2] }).expect(403);
      await admin.post('/api/users').send({ ...base, username: 'new-desk', role: 'USER', branchIds: [fx.a1] }).expect(201);
    });
  });

  describe('clients', () => {
    it('shares clients across branches and keeps phone numbers unique', async () => {
      const desk = await login('desk');
      const created = await desk
        .post('/api/clients')
        .set(BRANCH_HEADER, fx.a1)
        .send({ name: 'Riya Sharma', phone: '98765 43210', gender: 'FEMALE', dob: birthdayIn(2) })
        .expect(201);
      expect(created.body.data).toMatchObject({ phone: '9876543210', referralCode: expect.stringMatching(/^[A-Z2-9]{8}$/) });

      const dup = await desk.post('/api/clients').set(BRANCH_HEADER, fx.a1).send({ name: 'Someone', phone: '9876543210', gender: 'MALE' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.details).toEqual({ phone: 'Already exists' });

      const boss = await login('boss');
      const list = await boss.get('/api/clients?q=98765').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(list.body.data).toMatchObject({ total: 1, items: [{ name: 'Riya Sharma' }] });

      const segments = await boss.get('/api/clients/segments').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(segments.body.data).toMatchObject({ total: 1, new: 1, birthdays: 1, anniversaries: 0 });
      const birthdays = await boss.get('/api/clients?segment=birthdays').set(BRANCH_HEADER, fx.a2).expect(200);
      expect(birthdays.body.data.items.map((c) => c.name)).toEqual(['Riya Sharma']);
    });

    it('lists follow-ups on the Today page until they are completed', async () => {
      const desk = await login('desk');
      const client = (await desk.post('/api/clients').set(BRANCH_HEADER, fx.a1).send({ name: 'Follow Me', phone: '9000000111', gender: 'MALE' }).expect(201)).body.data;
      const followUp = (
        await desk.post(`/api/clients/${client.id}/follow-ups`).set(BRANCH_HEADER, fx.a1).send({ dueOn: istToday(), note: 'Call about bridal package' }).expect(201)
      ).body.data;

      const dueIds = async () => (await desk.get('/api/follow-ups/today').set(BRANCH_HEADER, fx.a1).expect(200)).body.data.clientFollowUps.map((f) => f.id);
      expect(await dueIds()).toContain(followUp.id);
      await desk.patch(`/api/clients/follow-ups/${followUp.id}/complete`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(await dueIds()).not.toContain(followUp.id);
    });

    it('imports clients from Excel without blanking existing details', async () => {
      const admin = await login('admin');
      const file = await clientSheet([
        ['Riya Sharma', '9876543210', '', 'riya@example.com', '', '', '', ''],
        ['Imported Person', '9000000444', 'Male', '', '01/02/1990', '', 'Client refrence', ''],
      ]);
      const res = await admin.post('/api/clients/import').set(BRANCH_HEADER, fx.a1).attach('file', file, 'clients.xlsx').expect(200);
      expect(res.body.data).toMatchObject({ created: 1, updated: 1, errors: [] });

      const riya = (await admin.get('/api/clients?q=9876543210').set(BRANCH_HEADER, fx.a1)).body.data.items[0];
      expect(riya).toMatchObject({ gender: 'FEMALE', email: 'riya@example.com', dob: birthdayIn(2) });
      const imported = (await admin.get('/api/clients?q=9000000444').set(BRANCH_HEADER, fx.a1)).body.data.items[0];
      expect(imported).toMatchObject({ dob: '1990-02-01', source: 'REFERRAL' });
    });
  });

  describe('enquiries', () => {
    const lead = { name: 'New Lead', phone: '9000000222', enquiryFor: 'Keratin treatment', type: 'HOT', source: 'INSTAGRAM' };

    it('keeps leads in their branch and reschedules them through responses', async () => {
      const desk = await login('desk');
      const created = (await desk.post('/api/enquiries').set(BRANCH_HEADER, fx.a1).send({ ...lead, followUpOn: istToday() }).expect(201)).body.data;

      const boss = await login('boss');
      expect((await boss.get('/api/enquiries').set(BRANCH_HEADER, fx.a2).expect(200)).body.data.total).toBe(0);

      const dueIds = async () => (await desk.get('/api/follow-ups/today').set(BRANCH_HEADER, fx.a1).expect(200)).body.data.enquiries.map((e) => e.id);
      expect(await dueIds()).toContain(created.id);

      const nextWeek = shiftIso(istToday(), 7);
      const reply = await desk
        .post(`/api/enquiries/${created.id}/responses`)
        .set(BRANCH_HEADER, fx.a1)
        .send({ note: 'Asked us to call next week', nextFollowUpOn: nextWeek })
        .expect(201);
      expect(reply.body.data.enquiry.followUpOn).toBe(nextWeek);
      expect(await dueIds()).not.toContain(created.id);

      const detail = await desk.get(`/api/enquiries/${created.id}`).set(BRANCH_HEADER, fx.a1).expect(200);
      expect(detail.body.data.responses).toMatchObject([{ note: 'Asked us to call next week', createdBy: { name: 'desk' } }]);
    });

    it('converts a lead into a new client, or links the existing client with that phone', async () => {
      const desk = await login('desk');
      const fresh = (await desk.post('/api/enquiries').set(BRANCH_HEADER, fx.a1).send({ ...lead, phone: '9000000333' }).expect(201)).body.data;
      const converted = await desk.post(`/api/enquiries/${fresh.id}/convert`).set(BRANCH_HEADER, fx.a1).send({ gender: 'FEMALE' }).expect(200);
      expect(converted.body.data).toMatchObject({ createdClient: true, enquiry: { status: 'CONVERTED' } });
      await desk.post(`/api/enquiries/${fresh.id}/convert`).set(BRANCH_HEADER, fx.a1).send({ gender: 'FEMALE' }).expect(409);

      const known = (await desk.post('/api/enquiries').set(BRANCH_HEADER, fx.a1).send({ ...lead, phone: '98765 43210' }).expect(201)).body.data;
      expect(known.client).toMatchObject({ name: 'Riya Sharma' });
      const linked = await desk.post(`/api/enquiries/${known.id}/convert`).set(BRANCH_HEADER, fx.a1).send({ gender: 'MALE' }).expect(200);
      expect(linked.body.data).toMatchObject({ createdClient: false, clientId: known.client.id });
    });
  });
});

async function seedFixtures(prisma) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "EnquiryResponse", "Enquiry", "ClientFollowUp", "Client", "Holiday", "BranchSetting", "TaxRate", "Service", "ServiceCategory", "Staff", "UserBranch", "User", "Branch", "Organization" CASCADE',
  );
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
  const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
  const a1 = await prisma.branch.create({ data: { organizationId: orgA.id, name: 'A1', salonName: 'Org A' } });
  const a2 = await prisma.branch.create({ data: { organizationId: orgA.id, name: 'A2', salonName: 'Org A' } });
  const b1 = await prisma.branch.create({ data: { organizationId: orgB.id, name: 'B1', salonName: 'Org B' } });

  const user = (username, role, branchIds) =>
    prisma.user.create({
      data: {
        organizationId: orgA.id,
        name: username,
        username,
        passwordHash,
        role,
        branches: { create: branchIds.map((branchId) => ({ branchId })) },
      },
    });
  await user('boss', 'SUPERADMIN', []);
  await user('admin', 'ADMIN', [a1.id]);
  await user('desk', 'USER', [a1.id]);
  await user('rotate', 'USER', [a1.id]);

  return { a1: a1.id, a2: a2.id, b1: b1.id };
}
