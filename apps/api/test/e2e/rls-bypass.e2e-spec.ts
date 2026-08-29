import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { getOwnerClient, resetDatabase } from './utils/test-app';

/**
 * Proves tenant isolation holds at the Postgres level, independent of the
 * app-level Prisma extension. Every query here goes through a raw
 * PrismaClient connected as the non-owner `lybid_app` runtime role, using
 * `$queryRaw`/`$executeRaw` directly — deliberately bypassing
 * `createTenantScopingExtension` so a bug in the app-level `where`-merging
 * logic could not make this test pass for the wrong reason.
 */
describe('Postgres RLS enforcement (e2e)', () => {
  let owner: PrismaClient;
  let runtime: PrismaClient;
  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    owner = getOwnerClient();
    runtime = new PrismaClient({
      datasourceUrl: process.env.RUNTIME_DATABASE_URL,
    });
  });

  afterAll(async () => {
    await owner.$disconnect();
    await runtime.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    const a = await owner.tenant.create({
      data: { name: 'Tenant A', slug: 'rls-tenant-a' },
    });
    const b = await owner.tenant.create({
      data: { name: 'Tenant B', slug: 'rls-tenant-b' },
    });
    tenantAId = a.id;
    tenantBId = b.id;
    await owner.apiKey.create({
      data: {
        tenantId: tenantAId,
        keyPrefix: 'rlsAprefx',
        keyHash: 'irrelevant-for-this-test',
        environment: 'LIVE',
      },
    });
    await owner.apiKey.create({
      data: {
        tenantId: tenantBId,
        keyPrefix: 'rlsBprefx',
        keyHash: 'irrelevant-for-this-test',
        environment: 'LIVE',
      },
    });
  });

  it('returns zero rows with no session GUC set at all, even though rows exist', async () => {
    const rows = await runtime.$queryRaw<unknown[]>`SELECT id FROM tenants`;
    expect(rows).toHaveLength(0);
  });

  it('a tenant-scoped connection sees only its own tenant row', async () => {
    const rows = await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantAId}, true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(tenantAId);
  });

  it("a tenant-scoped connection never sees another tenant's api key, even via a raw filterless query", async () => {
    const rows = await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantBId}, true)`;
      return tx.$queryRaw<
        { tenantId: string }[]
      >`SELECT "tenantId" FROM api_keys`;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].tenantId).toBe(tenantBId);
  });

  it('an admin-mode connection sees all tenants', async () => {
    const rows = await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.is_admin', 'true', true)`;
      return tx.$queryRaw<{ id: string }[]>`SELECT id FROM tenants`;
    });
    expect(rows).toHaveLength(2);
  });

  it('the auth-bootstrap policy permits the key-prefix lookup shape with no other GUC set', async () => {
    const rows = await runtime.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.auth_bootstrap', 'true', true)`;
      return tx.$queryRaw<
        { keyPrefix: string }[]
      >`SELECT "keyPrefix" FROM api_keys WHERE "keyPrefix" = 'rlsAprefx'`;
    });
    expect(rows).toHaveLength(1);
  });

  it('a tenant-mode connection cannot INSERT into tenants — only the admin policy grants writes', async () => {
    await expect(
      runtime.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantAId}, true)`;
        await tx.$executeRaw`INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), 'Sneaky', 'sneaky-slug', 'ACTIVE', now(), now())`;
      }),
    ).rejects.toThrow(/row-level security/i);
  });

  it('a fully unscoped connection (no GUCs at all) cannot INSERT into tenants either', async () => {
    await expect(
      runtime.$executeRaw`INSERT INTO tenants (id, name, slug, status, "createdAt", "updatedAt") VALUES (gen_random_uuid(), 'Sneaky2', 'sneaky-slug-2', 'ACTIVE', now(), now())`,
    ).rejects.toThrow(/row-level security/i);
  });
});
