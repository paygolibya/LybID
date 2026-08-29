import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';

const BCRYPT_ROUNDS = 12;

async function main(): Promise<void> {
  const email = process.env.ADMIN_BOOTSTRAP_EMAIL;
  const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
  if (!email || !password) {
    throw new Error('ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be set to seed the first platform admin');
  }

  // Runs as the runtime role; platform_admin_users has no RLS (it isn't
  // tenant-scoped), so a plain client is fine here.
  const prisma = new PrismaClient({ datasourceUrl: process.env.RUNTIME_DATABASE_URL });

  const existing = await prisma.platformAdminUser.findUnique({ where: { email } });
  if (existing) {
    console.log(`Platform admin ${email} already exists — skipping.`);
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);
  const admin = await prisma.platformAdminUser.create({
    data: { email, passwordHash, role: 'PLATFORM_ADMIN' },
  });

  console.log(`Seeded platform admin: ${admin.email} (${admin.id})`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
