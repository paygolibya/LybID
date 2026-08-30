import 'dotenv/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import { hash } from 'bcrypt';
import IORedis from 'ioredis';
import request from 'supertest';
import { AppModule } from '../../../src/app.module';
import { OcrClientService } from '../../../src/modules/documents/ocr-client/ocr-client.service';

// All e2e spec files share one live Postgres database and each resets it
// with a global TRUNCATE in beforeEach (see resetDatabase below) — running
// spec files in parallel Jest workers races these resets against each
// other. `pnpm test:e2e` runs with --runInBand for this reason; do not
// drop that flag without giving each spec file its own database/schema.
//
// It also runs with --forceExit: document-upload.e2e-spec.ts boots the
// real BullMQ queue/worker (Redis), and jest otherwise waits indefinitely
// for those connections to close even after app.close() — this looks
// exactly like a hang if you're watching the process, it isn't one.

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

/**
 * Same as createTestApp, but with OcrClientService overridden by a stub —
 * proves the upload -> queue -> worker -> CLS/tenant-transaction plumbing
 * end to end without depending on the real Python OCR sidecar being up.
 * Per the Phase 1 plan: prove the plumbing with a stub before wiring real
 * OCR. Still requires a real Redis and MinIO (both cheap/fast to run
 * locally) — only the OCR HTTP call itself is stubbed.
 */
export async function createTestAppWithStubOcr(
  stub: Pick<OcrClientService, 'extract'>,
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  })
    .overrideProvider(OcrClientService)
    .useValue(stub)
    .compile();
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
    'TRUNCATE TABLE audit_logs, document_extractions, documents, applicants, api_keys, tenants, platform_admin_users RESTART IDENTITY CASCADE',
  );
}

/**
 * Flushes the shared dev/test Redis instance. document-upload.e2e-spec.ts
 * (and manual smoke-testing against a locally running `pnpm dev`) all point
 * at the same Redis — a leftover/stalled BullMQ job from a previous run
 * (e.g. a retry still pending when a prior test process was force-killed)
 * can otherwise get picked up during a *later* test and processed against
 * whatever OcrClientService mock happens to be configured at that moment,
 * producing a result that belongs to no test that's actually running.
 */
export async function resetQueue(): Promise<void> {
  const redis = new IORedis(process.env.REDIS_URL as string, {
    maxRetriesPerRequest: null,
  });
  await redis.flushdb();
  await redis.quit();
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

export async function createApplicant(
  app: INestApplication,
  apiKeyToken: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await request(app.getHttpServer())
    .post('/v1/applicants')
    .set('X-API-Key', apiKeyToken)
    .send(body)
    .expect(201);
  return res.body.id as string;
}

/** Polls `check` until it returns truthy or `timeoutMs` elapses — used to await async queue-processed state in e2e tests. */
export async function waitFor<T>(
  check: () => Promise<T | undefined | null | false>,
  {
    timeoutMs = 15_000,
    intervalMs = 200,
  }: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const result = await check();
    if (result) return result;
    if (Date.now() > deadline) {
      throw new Error(`waitFor timed out after ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
