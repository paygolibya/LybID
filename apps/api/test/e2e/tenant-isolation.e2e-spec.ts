import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  createTenantWithApiKey,
  createTestApp,
  getOwnerClient,
  loginAsTestAdmin,
  resetDatabase,
  seedAdmin,
} from './utils/test-app';

describe('Tenant isolation (e2e)', () => {
  let app: INestApplication;
  let owner: PrismaClient;
  let adminToken: string;

  beforeAll(async () => {
    owner = getOwnerClient();
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await owner.$disconnect();
  });

  beforeEach(async () => {
    await resetDatabase(owner);
    await seedAdmin(owner);
    adminToken = await loginAsTestAdmin(app);
  });

  it("each tenant's key resolves to its own identity, never the other tenant's", async () => {
    const tenantA = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-of-tripoli',
    );
    const tenantB = await createTenantWithApiKey(
      app,
      adminToken,
      'bank-of-benghazi',
    );

    const resA = await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', tenantA.token)
      .expect(200);
    expect(resA.body.tenantId).toBe(tenantA.tenantId);
    expect(resA.body.tenantSlug).toBe('bank-of-tripoli');

    const resB = await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', tenantB.token)
      .expect(200);
    expect(resB.body.tenantId).toBe(tenantB.tenantId);
    expect(resB.body.tenantSlug).toBe('bank-of-benghazi');
  });

  it("admin listing tenant A's api keys never returns tenant B's keys", async () => {
    const tenantA = await createTenantWithApiKey(app, adminToken, 'bank-a');
    const tenantB = await createTenantWithApiKey(app, adminToken, 'bank-b');

    const resA = await request(app.getHttpServer())
      .get(`/admin/tenants/${tenantA.tenantId}/api-keys`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    expect(resA.body).toHaveLength(1);
    expect(resA.body[0].id).toBe(tenantA.keyId);
    expect(resA.body.some((k: { id: string }) => k.id === tenantB.keyId)).toBe(
      false,
    );
  });
});
