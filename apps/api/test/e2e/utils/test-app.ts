import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';

// All e2e spec files share one live Postgres database and each resets it
// with a global TRUNCATE in beforeEach (see resetDatabase below) — running
// spec files in parallel Jest workers races these resets against each
// other. `pnpm test:e2e` runs with --runInBand for this reason; do not
// drop that flag without giving each spec file its own database/schema.

export async function createTestApp(): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  await app.init();
  return app;
}

/** Connects as the table-owner role, which bypasses RLS — used only for test setup/teardown, never for asserting isolation. */
export function getOwnerClient(): PrismaClient {
  return new PrismaClient({ datasourceUrl: process.env.DATABASE_URL });
}

export async function resetDatabase(owner: PrismaClient): Promise<void> {
  await owner.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, api_keys, tenants, platform_admin_users RESTART IDENTITY CASCADE',
  );
}

export const TEST_ADMIN_EMAIL = 'test-admin@marsa.ly';
export const TEST_ADMIN_PASSWORD = 'test-password-123';

export async function seedAdmin(
  owner: PrismaClient,
  email: string = TEST_ADMIN_EMAIL,
  password: string = TEST_ADMIN_PASSWORD,
): Promise<string> {
  const passwordHash = await hash(password, 4); // low rounds — test speed, not production
  const admin = await owner.platformAdminUser.create({
    data: { email, passwordHash, role: 'PLATFORM_ADMIN' },
  });
  return admin.id;
}

export async function loginAsTestAdmin(app: INestApplication): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/admin/auth/login')
    .send({ email: TEST_ADMIN_EMAIL, password: TEST_ADMIN_PASSWORD })
    .expect(200);
  return res.body.accessToken as string;
}

export interface TestTenantAndKey {
  tenantId: string;
  slug: string;
  token: string;
  keyId: string;
}

/** Creates a tenant and issues a LIVE key for it via the real admin API — exercises the full stack, not a DB shortcut. */
export async function createTenantWithApiKey(
  app: INestApplication,
  adminToken: string,
  slug: string,
  opts: { expiresAt?: string } = {},
): Promise<TestTenantAndKey> {
  const tenantRes = await request(app.getHttpServer())
    .post('/admin/tenants')
    .set('Authorization', `Bearer ${adminToken}`)
    .send({ name: `Test Tenant ${slug}`, slug })
    .expect(201);

  const keyRes = await request(app.getHttpServer())
    .post(`/admin/tenants/${tenantRes.body.id}/api-keys`)
    .set('Authorization', `Bearer ${adminToken}`)
    .send({
      environment: 'LIVE',
      ...(opts.expiresAt ? { expiresAt: opts.expiresAt } : {}),
    })
    .expect(201);

  return {
    tenantId: tenantRes.body.id,
    slug,
    token: keyRes.body.token,
    keyId: keyRes.body.id,
  };
}
