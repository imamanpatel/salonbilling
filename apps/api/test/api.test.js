import bcrypt from 'bcryptjs';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BRANCH_HEADER } from '@salon/shared';
import { buildTemplate } from '../src/services/serviceImport.js';

const PASSWORD = 'Passw0rd!';

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
});

async function seedFixtures(prisma) {
  await prisma.$executeRawUnsafe(
    'TRUNCATE "Holiday", "BranchSetting", "TaxRate", "Service", "ServiceCategory", "Staff", "UserBranch", "User", "Branch", "Organization" CASCADE',
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
