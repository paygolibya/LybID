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

describe('ApiKeyGuard (e2e)', () => {
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

  it('accepts a valid, active key', async () => {
    const { token, slug } = await createTenantWithApiKey(
      app,
      adminToken,
      'valid-key-bank',
    );
    const res = await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', token)
      .expect(200);
    expect(res.body.tenantSlug).toBe(slug);
    expect(res.body.environment).toBe('LIVE');
  });

  it('rejects a request with no X-API-Key header', async () => {
    await request(app.getHttpServer()).get('/v1/whoami').expect(401);
  });

  it('rejects a malformed key', async () => {
    await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', 'not-a-real-key')
      .expect(401);
  });

  it('rejects a well-formed but unknown key', async () => {
    await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', 'lyb_live_ZmFrZWZha2VmYWtlZmFrZWZha2VmYWtlZmFrZQ')
      .expect(401);
  });

  it('rejects a revoked key', async () => {
    const { token, keyId } = await createTenantWithApiKey(
      app,
      adminToken,
      'revoked-key-bank',
    );
    await request(app.getHttpServer())
      .patch(`/admin/api-keys/${keyId}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', token)
      .expect(401);
  });

  it('rejects an expired key', async () => {
    const { token } = await createTenantWithApiKey(
      app,
      adminToken,
      'expired-key-bank',
      {
        expiresAt: new Date(Date.now() - 60_000).toISOString(),
      },
    );

    await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', token)
      .expect(401);
  });

  it('rejects a technically-valid key belonging to a suspended tenant', async () => {
    const { token, tenantId } = await createTenantWithApiKey(
      app,
      adminToken,
      'suspended-tenant-bank',
    );
    await request(app.getHttpServer())
      .patch(`/admin/tenants/${tenantId}/suspend`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/v1/whoami')
      .set('X-API-Key', token)
      .expect(401);
  });
});
