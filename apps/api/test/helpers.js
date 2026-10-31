import bcrypt from 'bcryptjs';
import request from 'supertest';

// Shared integration-test fixtures. Every test file should call `resetDatabase` + `seedBase` in beforeAll.

export const PASSWORD = 'Passw0rd!';

/** Empty every application table (keeps the migrations table). */
export async function resetDatabase(prisma) {
  const tables = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  }
}

/**
 * Org A with branches A1 and A2, org B with branch B1, users, a service catalogue, staff and taxes in A1.
 * Users (all with PASSWORD): boss (superadmin), admin (A1), desk (front desk, A1).
 */
export async function seedBase(prisma) {
  const passwordHash = await bcrypt.hash(PASSWORD, 4);
  const orgA = await prisma.organization.create({ data: { name: 'Org A' } });
  const orgB = await prisma.organization.create({ data: { name: 'Org B' } });
  const a1 = await prisma.branch.create({ data: { organizationId: orgA.id, name: 'A1', slug: 'a1', salonName: 'Salon A' } });
  const a2 = await prisma.branch.create({ data: { organizationId: orgA.id, name: 'A2', slug: 'a2', salonName: 'Salon A' } });
  const b1 = await prisma.branch.create({ data: { organizationId: orgB.id, name: 'B1', slug: 'b1', salonName: 'Salon B' } });
  for (const branch of [a1, a2, b1]) await prisma.branchSetting.create({ data: { branchId: branch.id } });

  const user = (username, role, branchIds, organizationId = orgA.id) =>
    prisma.user.create({
      data: {
        organizationId,
        name: username,
        username,
        passwordHash,
        role,
        branches: { create: branchIds.map((branchId) => ({ branchId })) },
      },
    });
  const boss = await user('boss', 'SUPERADMIN', []);
  const admin = await user('admin', 'ADMIN', [a1.id]);
  const desk = await user('desk', 'USER', [a1.id]);

  const gst18 = await prisma.taxRate.create({ data: { branchId: a1.id, name: 'GST 18%', ratePct: 18, appliesTo: 'ALL' } });
  const hair = await prisma.serviceCategory.create({ data: { branchId: a1.id, name: 'Hair' } });
  const haircut = await prisma.service.create({
    data: { branchId: a1.id, categoryId: hair.id, name: 'Haircut', gender: 'UNISEX', durationMin: 30, pricePaise: 50000, memberPricePaise: 40000, rewardPoints: 10 },
  });
  const colour = await prisma.service.create({
    data: { branchId: a1.id, categoryId: hair.id, name: 'Hair colour', gender: 'UNISEX', durationMin: 90, pricePaise: 250000, memberPricePaise: 220000, rewardPoints: 50 },
  });
  const staff = (name, phone, extra = {}) =>
    prisma.staff.create({
      data: { branchId: a1.id, kind: 'SERVICE_PROVIDER', name, phone, gender: 'FEMALE', joinedOn: new Date('2026-01-01'), serviceCommissionPct: 10, productCommissionPct: 5, ...extra },
    });
  const stylist = await staff('Stylist One', '9100000001');
  const stylist2 = await staff('Stylist Two', '9100000002');
  const client = await prisma.client.create({
    data: { organizationId: orgA.id, homeBranchId: a1.id, name: 'Test Client', phone: '9200000001', gender: 'FEMALE', referralCode: 'TESTCODE' },
  });

  return {
    orgA: orgA.id, orgB: orgB.id, a1: a1.id, a2: a2.id, b1: b1.id,
    users: { boss: boss.id, admin: admin.id, desk: desk.id },
    gst18: gst18.id, category: hair.id, haircut: haircut.id, colour: colour.id,
    stylist: stylist.id, stylist2: stylist2.id, client: client.id,
  };
}

/** A supertest agent signed in as `username` (cookie kept between requests). */
export async function login(app, username) {
  const agent = request.agent(app);
  await agent.post('/api/auth/login').send({ username, password: PASSWORD }).expect(200);
  return agent;
}
