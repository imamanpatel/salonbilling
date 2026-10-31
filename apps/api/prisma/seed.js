import bcrypt from 'bcryptjs';
import { PrismaClient } from '@prisma/client';
import { createBranchDefaults } from '../src/services/branchDefaults.js';

// Creates the organisation, its first branch and the superadmin. Safe to re-run.
const prisma = new PrismaClient();
const username = (process.env.SEED_ADMIN_USERNAME || 'superadmin').toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const orgName = process.env.SEED_ORG_NAME || 'My Salon';

async function main() {
  if (!password || password.length < 8) {
    throw new Error('Set SEED_ADMIN_PASSWORD (at least 8 characters) in apps/api/.env before seeding.');
  }
  if (await prisma.user.findUnique({ where: { username } })) {
    console.log(`User "${username}" already exists; nothing to seed.`);
    return;
  }
  await prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({ data: { name: orgName } });
    const branch = await tx.branch.create({ data: { organizationId: org.id, name: 'Main', salonName: orgName } });
    await createBranchDefaults(tx, branch.id);
    await tx.user.create({
      data: {
        organizationId: org.id,
        name: 'Super Admin',
        username,
        passwordHash: await bcrypt.hash(password, 12),
        role: 'SUPERADMIN',
      },
    });
  });
  console.log(`Seeded "${orgName}" with branch "Main" and superadmin "${username}".`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
